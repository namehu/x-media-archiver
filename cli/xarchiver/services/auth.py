"""认证相关的服务辅助函数。

把认证策略集中放在这里，确保 API 层和 CLI 触发的流程都遵循同一套
初始化令牌、密码校验和会话规则。
"""

from __future__ import annotations

import hashlib
import re
import secrets
from datetime import UTC, datetime, timedelta
from threading import Lock

import psycopg
from pwdlib import PasswordHash
from sqlalchemy import bindparam, delete, func, insert, select, update

from xarchiver.config import Settings, get_settings
from xarchiver.db import connect
from xarchiver.row_models import AuthAdminRow, AuthSessionRow
from xarchiver.sql_builder import compile_query
from xarchiver.tables import auth_admin, auth_sessions

ADMIN_ID = 1
SESSION_COOKIE = "xma_session"
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9._-]{3,64}$")
PASSWORD_MIN_LENGTH = 12
PASSWORD_MAX_LENGTH = 128
_password_hash = PasswordHash.recommended()
_setup_token_hash: str | None = None
_setup_lock = Lock()


class AuthError(ValueError):
    """认证输入或认证状态不合法时抛出。"""

    pass


def hash_token(token: str) -> str:
    """对会话令牌或初始化令牌做哈希后再入库。"""

    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def validate_username(username: str) -> str:
    """规范化并校验管理员用户名。"""

    normalized = username.strip()
    if not USERNAME_PATTERN.fullmatch(normalized):
        raise AuthError("invalid_username")
    return normalized


def validate_password(password: str) -> str:
    """校验密码长度，但不修改原始输入。"""

    if not PASSWORD_MIN_LENGTH <= len(password) <= PASSWORD_MAX_LENGTH:
        raise AuthError("invalid_password")
    return password


def get_admin() -> AuthAdminRow | None:
    """读取唯一的管理员账号；若尚未初始化则返回空。"""

    statement = select(auth_admin.c.id, auth_admin.c.username, auth_admin.c.password_hash).where(
        auth_admin.c.id == bindparam("admin_id", ADMIN_ID)
    )
    sql, params = compile_query(statement)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
    return AuthAdminRow.model_validate(row) if row else None


def initialize_setup_token(settings: Settings | None = None) -> str | None:
    """在启用认证且管理员尚未创建时生成一次性初始化令牌。"""

    global _setup_token_hash
    settings = settings or get_settings()
    if settings.auth_mode == "disabled" or get_admin() is not None:
        with _setup_lock:
            _setup_token_hash = None
        return None
    token = secrets.token_urlsafe(32)
    with _setup_lock:
        _setup_token_hash = hash_token(token)
    return token


def create_admin(setup_token: str, username: str, password: str) -> dict[str, object]:
    """消费初始化令牌并持久化首个管理员账号。"""

    global _setup_token_hash
    normalized_username = validate_username(username)
    validate_password(password)
    with _setup_lock:
        # 初始化令牌只保存哈希值，避免明文在首次返回之后继续驻留。
        if _setup_token_hash is None or not secrets.compare_digest(
            _setup_token_hash, hash_token(setup_token)
        ):
            raise AuthError("invalid_setup_token")
        statement = insert(auth_admin).values(
            id=ADMIN_ID,
            username=normalized_username,
            password_hash=_password_hash.hash(password),
            created_at=func.now(),
            updated_at=func.now(),
        )
        sql, params = compile_query(statement)
        try:
            with connect() as conn, conn.cursor() as cur:
                cur.execute(sql, params)
                conn.commit()
        except psycopg.IntegrityError as exc:
            raise AuthError("admin_already_initialized") from exc
        _setup_token_hash = None
    return {"id": ADMIN_ID, "username": normalized_username}


def create_login_session(
    username: str, password: str, settings: Settings | None = None
) -> tuple[dict[str, object], str] | None:
    """校验凭据，必要时升级密码哈希，并创建会话。"""

    settings = settings or get_settings()
    statement = (
        select(auth_admin.c.id, auth_admin.c.username, auth_admin.c.password_hash)
        .where(auth_admin.c.id == bindparam("admin_id", ADMIN_ID))
        .with_for_update()
    )
    sql, params = compile_query(statement)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
        if not row:
            return None
        admin = AuthAdminRow.model_validate(row)
        # 用户名和密码都尽量走常量时间校验，减少通过时序差异泄露有效性的风险。
        username_valid = secrets.compare_digest(admin.username, username.strip())
        try:
            password_valid, updated_hash = _password_hash.verify_and_update(
                password, admin.password_hash
            )
        except Exception:
            return None
        if not password_valid or not username_valid:
            return None
        if updated_hash:
            # 当底层库建议使用更强的哈希格式时，顺手完成升级，用户无感知。
            password_update = (
                update(auth_admin)
                .where(auth_admin.c.id == bindparam("admin_id", ADMIN_ID))
                .values(password_hash=updated_hash, updated_at=func.now())
            )
            update_sql, update_params = compile_query(password_update)
            cur.execute(update_sql, update_params)
        token = secrets.token_urlsafe(32)
        now = datetime.now(UTC)
        cleanup_sql, cleanup_params = compile_query(
            delete(auth_sessions).where(auth_sessions.c.expires_at <= bindparam("now", now))
        )
        cur.execute(cleanup_sql, cleanup_params)
        session_sql, session_params = compile_query(_session_insert(token, now, settings))
        cur.execute(session_sql, session_params)
        conn.commit()
    return {"id": admin.id, "username": admin.username}, token


def create_session(settings: Settings | None = None) -> str:
    """在不校验用户名密码的前提下直接创建认证会话。"""

    settings = settings or get_settings()
    token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    statement = _session_insert(token, now, settings)
    cleanup = delete(auth_sessions).where(auth_sessions.c.expires_at <= bindparam("now", now))
    with connect() as conn, conn.cursor() as cur:
        sql, params = compile_query(cleanup)
        cur.execute(sql, params)
        sql, params = compile_query(statement)
        cur.execute(sql, params)
        conn.commit()
    return token


def authenticate_session(token: str | None) -> dict[str, object] | None:
    """解析当前会话，并按需懒更新最近活跃时间。"""

    if not token:
        return None
    now = datetime.now(UTC)
    statement = (
        select(
            auth_admin.c.id,
            auth_admin.c.username,
            auth_sessions.c.last_seen_at,
            auth_sessions.c.expires_at,
        )
        .select_from(auth_sessions.join(auth_admin, auth_sessions.c.admin_id == auth_admin.c.id))
        .where(auth_sessions.c.token_hash == bindparam("token_hash", hash_token(token)))
    )
    sql, params = compile_query(statement)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
        if not row:
            return None
        session = AuthSessionRow.model_validate(row)
        if session.expires_at <= now:
            # 过期会话会被立刻清掉，避免表持续膨胀，也避免后续查询重复命中过期数据。
            revoke_session(token, conn=conn)
            return None
        if session.last_seen_at <= now - timedelta(minutes=5):
            touch = (
                update(auth_sessions)
                .where(auth_sessions.c.token_hash == bindparam("token_hash", hash_token(token)))
                .values(last_seen_at=now)
            )
            touch_sql, touch_params = compile_query(touch)
            cur.execute(touch_sql, touch_params)
            conn.commit()
    return {"id": session.id, "username": session.username}


def revoke_session(token: str, *, conn=None) -> None:
    """删除单个会话；若调用方已提供事务连接则复用它。"""

    statement = delete(auth_sessions).where(
        auth_sessions.c.token_hash == bindparam("token_hash", hash_token(token))
    )
    sql, params = compile_query(statement)
    if conn is not None:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()
        return
    with connect() as own_conn, own_conn.cursor() as cur:
        cur.execute(sql, params)
        own_conn.commit()


def change_password(current_password: str, new_password: str) -> None:
    """在校验旧密码后修改管理员密码。"""

    validate_password(new_password)
    statement = (
        select(auth_admin.c.password_hash)
        .where(auth_admin.c.id == bindparam("admin_id", ADMIN_ID))
        .with_for_update()
    )
    sql, params = compile_query(statement)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        admin = cur.fetchone()
        try:
            valid = bool(admin) and _password_hash.verify(current_password, str(admin["password_hash"]))
        except Exception:
            valid = False
        if not valid:
            raise AuthError("invalid_credentials")
        _write_password_and_clear_sessions(cur, new_password)
        conn.commit()


def reset_password(new_password: str) -> None:
    """不校验旧密码，直接重置管理员密码。"""

    validate_password(new_password)
    with connect() as conn, conn.cursor() as cur:
        lock = (
            select(auth_admin.c.id)
            .where(auth_admin.c.id == bindparam("admin_id", ADMIN_ID))
            .with_for_update()
        )
        sql, params = compile_query(lock)
        cur.execute(sql, params)
        if not cur.fetchone():
            raise AuthError("admin_not_initialized")
        _write_password_and_clear_sessions(cur, new_password)
        conn.commit()


def _session_insert(token: str, now: datetime, settings: Settings):
    """构造所有会话创建路径共用的插入语句。"""

    return insert(auth_sessions).values(
        token_hash=hash_token(token),
        admin_id=ADMIN_ID,
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(hours=settings.auth_session_ttl_hours),
    )


def _write_password_and_clear_sessions(cur, password: str) -> None:
    """写入新密码哈希，并让所有已有会话失效。"""

    statement = (
        update(auth_admin)
        .where(auth_admin.c.id == bindparam("admin_id", ADMIN_ID))
        .values(password_hash=_password_hash.hash(password), updated_at=func.now())
    )
    sql, params = compile_query(statement)
    cur.execute(sql, params)
    sql, params = compile_query(delete(auth_sessions))
    cur.execute(sql, params)
