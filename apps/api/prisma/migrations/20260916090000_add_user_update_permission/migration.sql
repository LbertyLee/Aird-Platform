-- Separate user editing from menu visibility. Existing non-admin roles remain read-only
-- until an administrator explicitly grants this permission.
INSERT INTO "permissions" ("id", "code", "name", "type", "sort", "updated_at")
SELECT 'perm_user_update_20260916', 'button:user:update', '用户编辑', 'button', 101, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "permissions"
  WHERE "code" = 'button:user:update' AND "deleted_at" IS NULL
);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" = 'platform_admin'
  AND r."deleted_at" IS NULL
  AND p."code" = 'button:user:update'
  AND p."deleted_at" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
