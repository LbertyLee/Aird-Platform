import { http } from './http';

export type Announcement = {
  id: string;
  title: string;
  content: string;
  publishedAt: string | null;
};

export type UserNotification = {
  id: string;
  content: string;
  status: 'unread' | 'read';
  bizType: string;
  sentAt: string;
};

type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export async function fetchMessageCenter(params?: {
  bizType?: string;
  timeRange?: string;
}) {
  const [announcements, notifications] = await Promise.all([
    http.get<{ items: Announcement[] }>('/user/operation/announcements', {
      params: { page: 1, pageSize: 20 },
    }),
    http.get<Page<UserNotification>>('/user/operation/notifications', {
      params: {
        page: 1,
        pageSize: 50,
        bizType: params?.bizType && params.bizType !== 'all' ? params.bizType : undefined,
        timeRange:
          params?.timeRange && params.timeRange !== 'all'
            ? params.timeRange
            : undefined,
      },
    }),
  ]);
  return {
    announcements: announcements.data.items,
    notifications: notifications.data.items,
  };
}

export async function markUserNotificationRead(id: string) {
  return (await http.post<UserNotification>(`/user/operation/notifications/${id}/read`)).data;
}

export async function markAllUserNotificationsRead() {
  return (
    await http.post<{ ok: boolean; count: number }>(
      '/user/operation/notifications/read-all',
    )
  ).data;
}
