import type { ModalProps } from 'antd';

/** 表单类弹窗默认宽度 */
export const FORM_MODAL_WIDTH = 'min(760px, calc(100vw - 32px))';

/** 宽表单 / 配置类弹窗 */
export const FORM_MODAL_WIDTH_LG = 'min(880px, calc(100vw - 32px))';

/** 预览类弹窗 */
export const PREVIEW_MODAL_WIDTH = 'min(1100px, 92vw)';

/**
 * 管理端表单弹窗统一布局属性（可被页面覆盖）。
 */
export const formModalProps: Pick<
  ModalProps,
  'centered' | 'destroyOnClose' | 'width' | 'className' | 'styles'
> = {
  centered: true,
  destroyOnClose: true,
  width: FORM_MODAL_WIDTH,
  className: 'admin-form-modal',
  styles: {
    body: {
      maxHeight: 'min(72vh, 680px)',
      overflowY: 'auto',
      paddingTop: 8,
      paddingBottom: 4,
    },
  },
};

/**
 * 合并表单弹窗默认属性。
 */
export function withFormModal(props: ModalProps = {}): ModalProps {
  const { className, styles, width, ...rest } = props;
  return {
    ...formModalProps,
    ...rest,
    width: width ?? formModalProps.width,
    className: ['admin-form-modal', className].filter(Boolean).join(' '),
    styles: {
      ...formModalProps.styles,
      ...styles,
      body: {
        ...formModalProps.styles?.body,
        ...styles?.body,
      },
    },
  };
}
