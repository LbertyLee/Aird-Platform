// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { LoginResponse } from '@agent/contracts';
import SettlementPage from './SettlementPage';
import * as membership from '../api/membership';

vi.mock('../api/membership', () => ({
  fetchMembershipStatus: vi.fn(),
  fetchMyOrders: vi.fn(),
  payMembershipOrder: vi.fn(),
  syncMembershipOrder: vi.fn(),
  cancelMembershipOrder: vi.fn(),
}));
vi.mock('../layouts/ResearchLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  notifyMembershipUpdated: vi.fn(),
}));
vi.mock('../components/NotificationCenter', () => ({
  notifyNotificationsUpdated: vi.fn(),
}));
vi.mock('antd', () => ({
  Modal: ({
    open,
    children,
    footer,
    onCancel,
  }: {
    open: boolean;
    children: React.ReactNode;
    footer: React.ReactNode;
    onCancel: () => void;
  }) =>
    open ? (
      <div role="dialog">
        <button onClick={onCancel}>关闭弹窗</button>
        {children}
        {footer}
      </div>
    ) : null,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

async function openCashier(
  open = true,
  expiresAt = new Date(Date.now() + 600_000).toISOString(),
) {
  vi.mocked(membership.fetchMembershipStatus).mockResolvedValue({
    isMember: false,
  } as membership.MembershipStatus);
  vi.mocked(membership.fetchMyOrders).mockResolvedValue({
    items: [
      {
        id: 'order-1',
        orderNo: 'ORDER001',
        status: 'pending',
        content: '测试套餐',
        amount: 0.01,
        expiresAt,
      },
    ],
  } as Awaited<ReturnType<typeof membership.fetchMyOrders>>);
  vi.mocked(membership.payMembershipOrder).mockResolvedValue({
    payMode: 'alipay_page',
    payForm:
      '<form target="_blank" action="https://openapi.alipay.com/gateway.do" method="post"><input name="sign" value="signed-value"></form>',
  } as Awaited<ReturnType<typeof membership.payMembershipOrder>>);
  render(
    <MemoryRouter>
      <SettlementPage
        session={{ accessToken: 'test' } as LoginResponse}
        onLogout={() => {}}
      />
    </MemoryRouter>,
  );
  await screen.findByText('订单号 ORDER001');
  if (!open) return;
  fireEvent.click(screen.getByRole('button', { name: '支付宝' }));
  fireEvent.click(await screen.findByRole('button', { name: '立即支付' }));
  await screen.findByRole('dialog');
}

describe('embedded Alipay cashier', () => {
  it('requires selecting a payment method and places payment in the method section', async () => {
    await openCashier(false);
    const pay = screen.getByRole('button', {
      name: '立即支付',
    }) as HTMLButtonElement;
    expect(pay.disabled).toBe(true);
    expect(pay.closest('section')?.className).toBe('settlement-channel-card');
    fireEvent.click(screen.getByRole('button', { name: '支付宝' }));
    expect(pay.disabled).toBe(false);
    expect(screen.getByRole('timer').textContent).toContain('10:00');
  });

  it('blocks expired payments while retaining result queries', async () => {
    await openCashier(false, new Date(Date.now() - 1000).toISOString());
    fireEvent.click(screen.getByRole('button', { name: '支付宝' }));
    expect(
      (screen.getByRole('button', { name: '支付已超时' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByRole('timer').textContent).toContain('支付时间已结束');
    expect(
      (
        screen.getByRole('button', {
          name: '我已支付，查询结果',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(membership.payMembershipOrder).not.toHaveBeenCalled();
  });

  it('updates the countdown from the deadline and disables payment at zero', async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    await openCashier(false, new Date(start + 10_000).toISOString());
    fireEvent.click(screen.getByRole('button', { name: '支付宝' }));
    expect(screen.getByRole('timer').textContent).toContain('00:10');
    clock.mockReturnValue(start + 10_000);
    await waitFor(
      () =>
        expect(
          (
            screen.getByRole('button', {
              name: '支付已超时',
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(true),
      { timeout: 1800 },
    );
  });

  it('opens a modal and submits the signed form inside its frame', async () => {
    await openCashier();
    const frame = screen.getByTitle('支付宝收银台');
    const html = frame.getAttribute('srcdoc')!;
    expect(html).toContain('target="_self"');
    expect(html).not.toContain('_blank');
    expect(html).toContain('signed-value');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-popups');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation');
  });

  it('shows the WeChat Native QR in the cashier and keeps the chosen channel locked', async () => {
    await openCashier(false);
    vi.mocked(membership.payMembershipOrder).mockResolvedValue({
      payMode: 'wechat_native',
      qrCode: 'weixin://wxpay/test',
    } as Awaited<ReturnType<typeof membership.payMembershipOrder>>);
    fireEvent.click(screen.getByRole('button', { name: '微信支付' }));
    fireEvent.click(screen.getByRole('button', { name: '立即支付' }));
    await screen.findByRole('dialog');
    expect(screen.getByTitle('微信支付二维码').closest('svg')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: '支付宝' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: '微信支付' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(membership.payMembershipOrder).toHaveBeenCalledWith(
      'order-1',
      'wechat',
      'page',
    );
  });

  it('closing the modal stops polling without cancelling the order', async () => {
    await openCashier();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(membership.cancelMembershipOrder).not.toHaveBeenCalled();
    expect(membership.syncMembershipOrder).not.toHaveBeenCalled();
  });

  it('closes the cashier after the server confirms payment', async () => {
    await openCashier();
    vi.mocked(membership.syncMembershipOrder).mockResolvedValue({
      status: 'paid',
    } as Awaited<ReturnType<typeof membership.syncMembershipOrder>>);
    fireEvent.click(
      screen.getAllByRole('button', { name: '我已支付，查询结果' }).at(-1)!,
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(membership.syncMembershipOrder).toHaveBeenCalledWith('ORDER001');
    expect(await screen.findByText('支付成功，会员已开通')).toBeTruthy();
  });

  it('automatically detects payment without a browser redirect', async () => {
    await openCashier();
    vi.mocked(membership.syncMembershipOrder).mockResolvedValue({
      status: 'paid',
    } as Awaited<ReturnType<typeof membership.syncMembershipOrder>>);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), {
      timeout: 4500,
    });
    expect(membership.syncMembershipOrder).toHaveBeenCalledWith('ORDER001');
    expect(screen.getByText('支付成功，会员已开通')).toBeTruthy();
  });
});
