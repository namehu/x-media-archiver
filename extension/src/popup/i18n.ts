type MessageKey = Parameters<typeof browser.i18n.getMessage>[0];

export function t(name: MessageKey, substitutions?: string | string[]) {
  const message = browser.i18n.getMessage(name, substitutions);
  return message || name;
}
