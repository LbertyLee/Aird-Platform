import { Checkbox, Space, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { useCallback, useMemo, useState } from 'react';
import './PermissionTreeSelect.css';

export interface PermissionTreeNode {
  id: string;
  code: string;
  name: string;
  type: string;
  children?: PermissionTreeNode[];
}

/** 收集权限树中全部可选权限 ID（不含分组节点） */
export function collectAllPermissionIds(nodes: PermissionTreeNode[]): string[] {
  return collectIds(nodes).filter((id) => !id.startsWith('section:'));
}

interface PermissionTreeSelectProps {
  tree: PermissionTreeNode[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

function collectIds(nodes: PermissionTreeNode[]): string[] {
  const ids: string[] = [];
  const walk = (list: PermissionTreeNode[]) => {
    for (const node of list) {
      ids.push(node.id);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return ids;
}

function toAntTreeData(nodes: PermissionTreeNode[]): DataNode[] {
  return nodes.map((node) => ({
    key: node.id,
    disableCheckbox: node.type === 'section',
    title: (
      <span className="perm-tree-node">
        <span>{node.name}</span>
        {node.type !== 'section' ? (
          <span className="perm-tree-node-code">{node.code}</span>
        ) : null}
      </span>
    ),
    children: node.children?.length ? toAntTreeData(node.children) : undefined,
  }));
}

/** 将扁平权限列表组装为「菜单 → 按钮/导出」树 */
export function buildPermissionTreeFromFlat(
  flat: PermissionTreeNode[],
): PermissionTreeNode[] {
  if (flat.some((node) => node.children?.length)) {
    return flat;
  }

  const byCode = new Map(flat.map((item) => [item.code, item]));
  const menus = flat
    .filter((item) => item.type === 'menu')
    .sort((a, b) => a.code.localeCompare(b.code));
  const attached = new Set<string>();

  /** 按钮码前缀 → 挂载菜单（历史命名与菜单不一致时） */
  const buttonAliases: Record<string, string[]> = {
    'menu:knowledge:public-review': ['button:knowledge:audit:'],
    'menu:knowledge:user': [
      'button:knowledge:category:',
      'button:knowledge:tag:',
    ],
  };

  const attachButtons = (menu: PermissionTreeNode): PermissionTreeNode => {
    const menuPath = menu.code.replace(/^menu:/, '');
    const aliasPrefixes = buttonAliases[menu.code] ?? [];
    const children = flat.filter((item) => {
      if (item.id === menu.id) return false;
      if (item.type === 'button') {
        if (item.code.startsWith(`button:${menuPath}:`)) return true;
        return aliasPrefixes.some((prefix) => item.code.startsWith(prefix));
      }
      if (item.type === 'export') {
        return item.code === `export:${menuPath.split(':')[0]}`;
      }
      return false;
    });
    children.forEach((c) => attached.add(c.id));
    return {
      ...menu,
      children: children.length ? children : undefined,
    };
  };

  const sections: Array<{ title: string; menuCodes: string[] }> = [
    {
      title: '运营看板',
      menuCodes: ['menu:dashboard'],
    },
    {
      title: '账号与权限',
      menuCodes: [
        'menu:user',
        'menu:membership:level',
        'menu:membership:order',
        'menu:rbac:role',
      ],
    },
    {
      title: '数据资源 / 数据治理',
      menuCodes: [
        'menu:data:indicator',
        'menu:data:dict',
        'menu:data:dataset',
        'menu:data:structured-data',
        'menu:data:field-mapping',
      ],
    },
    {
      title: '知识库管理',
      menuCodes: [
        'menu:knowledge:library',
        'menu:knowledge:user',
        'menu:knowledge:public-review',
        'menu:knowledge:index',
      ],
    },
    {
      title: '运营与系统',
      menuCodes: [
        'menu:oper:log',
        'menu:operation:announcement',
        'menu:system:backup',
      ],
    },
  ];

  const roots: PermissionTreeNode[] = [];
  for (const section of sections) {
    const sectionMenus = section.menuCodes
      .map((code) => byCode.get(code))
      .filter((item): item is PermissionTreeNode => !!item)
      .map(attachButtons);
    if (!sectionMenus.length) continue;
    sectionMenus.forEach((m) => attached.add(m.id));
    roots.push({
      id: `section:${section.title}`,
      code: section.title,
      name: section.title,
      type: 'section',
      children: sectionMenus,
    });
  }

  const orphanMenus = menus
    .filter((m) => !attached.has(m.id))
    .map(attachButtons);
  roots.push(...orphanMenus);

  const dataPerms = flat.filter(
    (item) => item.type === 'data' && !attached.has(item.id),
  );
  if (dataPerms.length) {
    roots.push({
      id: 'section:data-scope',
      code: 'data-scope',
      name: '数据范围',
      type: 'section',
      children: dataPerms,
    });
  }

  return roots;
}

/**
 * 菜单权限树：支持展开/折叠、全选、父子联动。
 */
export function PermissionTreeSelect({
  tree,
  value,
  onChange,
  disabled = false,
}: PermissionTreeSelectProps) {
  const [expandAll, setExpandAll] = useState(true);
  const [parentLinked, setParentLinked] = useState(true);

  const allKeys = useMemo(() => collectIds(tree), [tree]);
  const leafKeys = useMemo(() => {
    const leaves: string[] = [];
    const walk = (nodes: PermissionTreeNode[]) => {
      for (const node of nodes) {
        if (node.type === 'section') {
          if (node.children?.length) walk(node.children);
          continue;
        }
        if (!node.children?.length) {
          leaves.push(node.id);
        } else {
          walk(node.children);
        }
      }
    };
    walk(tree);
    return leaves;
  }, [tree]);

  const treeData = useMemo(() => toAntTreeData(tree), [tree]);

  const handleCheck: NonNullable<React.ComponentProps<typeof Tree>['onCheck']> =
    useCallback(
      (checked) => {
        const keys = (Array.isArray(checked) ? checked : checked.checked).map(
          (key) => String(key),
        );
        onChange(keys.filter((key) => !key.startsWith('section:')));
      },
      [onChange],
    );

  return (
    <div className="perm-tree-select">
      <Space wrap className="perm-tree-toolbar">
        <Checkbox
          checked={expandAll}
          disabled={disabled}
          onChange={(e) => setExpandAll(e.target.checked)}
        >
          展开/折叠
        </Checkbox>
        <Checkbox
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? [...leafKeys] : [])}
        >
          全选/全不选
        </Checkbox>
        <Checkbox
          checked={parentLinked}
          disabled={disabled}
          onChange={(e) => setParentLinked(e.target.checked)}
        >
          父子联动
        </Checkbox>
      </Space>
      <div className="perm-tree-panel">
        <Tree
          checkable
          disabled={disabled}
          selectable={false}
          checkStrictly={!parentLinked}
          expandedKeys={expandAll ? allKeys : []}
          onExpand={(keys) => setExpandAll(keys.length > 0)}
          treeData={treeData}
          checkedKeys={value}
          onCheck={handleCheck}
        />
      </div>
    </div>
  );
}
