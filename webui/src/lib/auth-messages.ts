const authErrorMessages: Record<string, string> = {
  invalid_credentials: "用户名或密码不正确。",
  invalid_setup_token: "一次性设置令牌无效或已过期。",
  admin_already_initialized: "管理员已经初始化，请刷新后登录。",
  login_rate_limited: "登录尝试过多，请在 15 分钟后重试。",
  invalid_username: "用户名格式不正确。",
  invalid_password: "密码必须为 12–128 个字符。",
  password_mismatch: "两次输入的密码不一致。",
  unknown: "请求失败，请稍后重试。",
};

export function authErrorMessage(code?: string | null) {
  return authErrorMessages[code || "unknown"] || authErrorMessages.unknown;
}
