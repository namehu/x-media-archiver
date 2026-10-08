"""下载器共用的出站代理配置与参数。"""

from urllib.parse import urlsplit

from pydantic import SecretStr


def normalize_proxy_url(value: str | SecretStr | None) -> str | None:
    """校验 HTTP 代理地址；错误信息不携带可能包含凭据的输入。"""

    if isinstance(value, SecretStr):
        value = value.get_secret_value()
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    error = "NETWORK_PROXY_URL must be an HTTP proxy URL with a valid host and port"
    if any(character.isspace() or ord(character) < 32 for character in value):
        raise ValueError(error)
    try:
        parsed = urlsplit(value)
        valid = (
            parsed.scheme == "http"
            and bool(parsed.hostname)
            and parsed.netloc.count("@") <= 1
            and (parsed.port is None or 1 <= parsed.port <= 65535)
            and parsed.path in {"", "/"}
            and not parsed.query
            and not parsed.fragment
        )
    except ValueError:
        raise ValueError(error) from None
    if not valid:
        raise ValueError(error)
    return value


def proxy_arguments(engine: str, proxy_url: str | SecretStr | None) -> list[str]:
    """显式代理覆盖环境配置；未配置时不改变下载器的原有行为。"""

    url = normalize_proxy_url(proxy_url)
    if url is None:
        return []
    arguments = ["--proxy", url]
    if engine == "gallery-dl":
        # requests 的环境代理会覆盖 session.proxies，必须一起禁用环境读取。
        arguments.extend(["-o", "proxy-env=false"])
    return arguments
