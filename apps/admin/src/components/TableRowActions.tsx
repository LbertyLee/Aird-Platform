import './TableRowActions.css';
import { MoreOutlined } from '@ant-design/icons';
import { Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import type { ReactNode } from 'react';

export type TableRowActionItem = {
  key: string;
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  hidden?: boolean;
  /** 始终行内展示，不进入「更多」 */
  inline?: boolean;
  linkClassName?: string;
};

type TableRowActionsProps = {
  actions: TableRowActionItem[];
  /** 未标记 inline 时，行内展示的前几项数量；其余进入「更多」 */
  inlineCount?: number;
  className?: string;
};

/**
 * 表格行操作：主操作行内展示，其余收入「更多」，避免窄屏换行撑高行高。
 */
export function TableRowActions({
  actions,
  inlineCount = 1,
  className,
}: TableRowActionsProps) {
  const visible = actions.filter((action) => !action.hidden);
  if (visible.length === 0) return null;

  const inlineMarked = visible.filter((action) => action.inline);
  const withoutInlineMark = visible.filter((action) => !action.inline);

  let inline: TableRowActionItem[];
  let inMenu: TableRowActionItem[];

  if (inlineMarked.length > 0) {
    inline = inlineMarked;
    inMenu = withoutInlineMark;
  } else if (visible.length <= inlineCount + 1) {
    inline = visible;
    inMenu = [];
  } else {
    inline = visible.slice(0, inlineCount);
    inMenu = visible.slice(inlineCount);
  }

  const menuItems: MenuProps['items'] = inMenu.map((item) => ({
    key: item.key,
    label: item.label,
    disabled: item.disabled,
    danger: item.danger,
    onClick: () => item.onClick(),
  }));

  return (
    <div
      className={['admin-table-row-actions', className]
        .filter(Boolean)
        .join(' ')}
    >
      {inline.map((item) => (
        <Button
          key={item.key}
          type="link"
          className={item.linkClassName}
          disabled={item.disabled}
          onClick={item.onClick}
        >
          {item.label}
        </Button>
      ))}
      {inMenu.length > 0 ? (
        <Dropdown menu={{ items: menuItems }} trigger={['click']}>
          <Button
            type="link"
            className="admin-table-row-actions-more"
            icon={<MoreOutlined />}
          >
            更多
          </Button>
        </Dropdown>
      ) : null}
    </div>
  );
}
