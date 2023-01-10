import crypto from 'crypto';

const BUNDLE_PREFIX = 'NOSLATED';

export function normalizeFuncNameToName(funcName: string) {
  return funcName.replace(/[^0-9a-zA-Z_\-.]/g, '_');
}

/**
 * codeBundleName
 * @param funcName name of the function
 * @param signature the signature
 * @param url download URL
 * @return `{BUNDLE_PREFIX}-{func_name}-{url_hashing}-{oss_hashing}`
 */
export function codeBundleName(
  funcName: string,
  signature: string,
  url: string
): string {
  const hash = crypto.createHash('sha1');
  hash.update(url);
  const urlHash = hash.digest('hex').substring(0, 8);
  const baseName = normalizeFuncNameToName(funcName);
  return `${BUNDLE_PREFIX}-${baseName}-${urlHash}-${signature}`;
}

/**
 * processName
 * @param funcName name of the function
 * @return `{BUNDLE_PREFIX}-{func_name}-{uuid}`
 */
export function processName(funcName: string): string {
  const hash = crypto.createHash('sha1');
  hash.update(`${funcName}-${crypto.randomUUID()}`);
  const first7 = hash.digest('hex').substring(0, 7);

  return `${normalizeFuncNameToName(funcName)}-${first7}`;
}

/**
 * credential
 * @param funcName name of the function
 * @return `{funcName}-{uuid}-{randomSkill}`
 */
export function credential(funcName: string): string {
  return `${funcName}-${crypto.randomUUID()}`;
}
