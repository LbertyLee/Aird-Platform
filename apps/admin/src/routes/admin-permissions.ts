/** Page access rules shared by menu rendering, tabs and direct navigation. */
export const ADMIN_PAGE_PERMISSIONS: Record<string, string | null> = {
  '/': 'menu:dashboard',
  '/users': 'menu:user',
  '/agents': 'menu:agent',
  '/membership': 'menu:membership:level',
  '/payment/config': 'menu:payment:config',
  '/rbac/roles': 'menu:rbac:role',
  '/oper-logs': 'menu:oper:log',
  '/operation/announcements': 'menu:operation:announcement',
  '/system/backups': 'menu:system:backup',
  '/system/search-models': 'menu:system:search-model',
  '/data/indicators': 'menu:data:indicator',
  '/data/dictionaries': 'menu:data:dict',
  '/data/datasets': 'menu:data:dataset',
  '/data/structured-data': 'menu:data:structured-data',
  '/data/field-mappings': 'menu:data:field-mapping',
  '/data/ingestion-jobs': 'menu:data:field-mapping|menu:knowledge:library',
  '/data/search-test': 'menu:data:field-mapping|menu:knowledge:library',
  '/knowledge/library': 'menu:knowledge:library',
  '/knowledge/library-detail': 'menu:knowledge:library',
  '/knowledge/user': 'menu:knowledge:user',
  '/knowledge/user-detail': 'menu:knowledge:user',
  '/knowledge/public-review': 'menu:knowledge:public-review',
  '/knowledge/indexes': 'menu:knowledge:index',
  '/profile': null,
};

export function canAccessAdminPage(path: string, codes: string[]): boolean {
  if (!(path in ADMIN_PAGE_PERMISSIONS)) return false;
  const required = ADMIN_PAGE_PERMISSIONS[path];
  return (
    required === null ||
    required.split('|').some((code) => codes.includes(code))
  );
}

export function firstAccessibleAdminPage(codes: string[]): string {
  return (
    Object.keys(ADMIN_PAGE_PERMISSIONS).find((path) =>
      canAccessAdminPage(path, codes),
    ) ?? '/profile'
  );
}
