// FIB permissions can exist in the shared DB, but must not be managed by LSPD.
export const isFIBClassificationKey = key => /^(?:fib[._-])?classif(?:ication|ied|ications)(?:[._-]|$)/i.test(String(key||''));
export const isLspdPermission = p => !isFIBClassificationKey(p?.key) && !/^P_LSPD_(?:373_)?CLASS(?:IFICATION)?_/i.test(String(p?.id||''));
