import {
  meApi,
  updateMyProfileApi,
  changeMyPasswordApi,
} from '../api/auth';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Row,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/session';
import { cancelAccessTokenRefresh } from '../api/http';

type ProfileDetail = Awaited<ReturnType<typeof meApi>>;

/**
 * 当前登录用户：资料管理与修改密码。
 */
export function ProfilePage() {
  const navigate = useNavigate();
  const patchProfile = useSessionStore((s) => s.patchProfile);
  const clear = useSessionStore((s) => s.clear);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileDetail | null>(null);
  const [profileForm] = Form.useForm();
  const [pwdForm] = Form.useForm();
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await meApi();
      setProfile(data);
      profileForm.setFieldsValue({
        displayName: data.displayName,
        email: data.email,
        phone: data.phone,
      });
    } catch {
      message.error('加载个人信息失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onSaveProfile = async () => {
    const values = await profileForm.validateFields();
    setSavingProfile(true);
    try {
      const data = await updateMyProfileApi(values);
      setProfile(data);
      patchProfile({
        permissionCodes: data.permissionCodes,
        profile: {
          id: data.id,
          username: data.username,
          displayName: data.displayName,
        },
      });
      message.success('资料已更新');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSavingProfile(false);
    }
  };

  const onChangePassword = async () => {
    const values = await pwdForm.validateFields();
    if (values.newPassword !== values.confirmPassword) {
      message.error('两次输入的新密码不一致');
      return;
    }
    setSavingPwd(true);
    try {
      await changeMyPasswordApi({
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });
      message.success('密码已修改，请重新登录');
      cancelAccessTokenRefresh();
      clear();
      navigate('/login', { replace: true });
    } catch (e) {
      message.error(e instanceof Error ? e.message : '修改密码失败');
    } finally {
      setSavingPwd(false);
    }
  };

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        个人信息
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        管理当前账号的基本资料与登录密码
      </Typography.Paragraph>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="基本资料" loading={loading}>
            <Form form={profileForm} layout="vertical" requiredMark={false}>
              <Form.Item label="用户名">
                <Input value={profile?.username} disabled />
              </Form.Item>
              <Form.Item name="displayName" label="显示名">
                <Input placeholder="请输入显示名" />
              </Form.Item>
              <Form.Item
                name="email"
                label="邮箱"
                rules={[{ type: 'email', message: '邮箱格式不正确' }]}
              >
                <Input placeholder="请输入邮箱" />
              </Form.Item>
              <Form.Item name="phone" label="手机号">
                <Input placeholder="请输入手机号" />
              </Form.Item>
              <Button
                type="primary"
                loading={savingProfile}
                onClick={() => void onSaveProfile()}
              >
                保存资料
              </Button>
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title="账号概览" loading={loading} style={{ marginBottom: 16 }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="状态">
                <Tag color={profile?.status === 'active' ? 'success' : 'default'}>
                  {profile?.status === 'active' ? '启用' : profile?.status || '-'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="角色">
                {profile?.roles?.length
                  ? profile.roles.map((r) => (
                      <Tag key={r.id}>{r.name}</Tag>
                    ))
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="最近登录">
                {profile?.lastLoginAt
                  ? new Date(profile.lastLoginAt).toLocaleString()
                  : '-'}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Card title="修改密码">
            <Form form={pwdForm} layout="vertical" requiredMark={false}>
              <Form.Item
                name="oldPassword"
                label="当前密码"
                rules={[{ required: true, message: '请输入当前密码' }]}
              >
                <Input.Password placeholder="请输入当前密码" />
              </Form.Item>
              <Form.Item
                name="newPassword"
                label="新密码"
                rules={[
                  { required: true, message: '请输入新密码' },
                  { min: 6, message: '至少 6 位' },
                ]}
              >
                <Input.Password placeholder="请输入新密码" />
              </Form.Item>
              <Form.Item
                name="confirmPassword"
                label="确认新密码"
                rules={[{ required: true, message: '请再次输入新密码' }]}
              >
                <Input.Password placeholder="请再次输入新密码" />
              </Form.Item>
              <Space>
                <Button
                  type="primary"
                  danger
                  loading={savingPwd}
                  onClick={() => void onChangePassword()}
                >
                  修改密码
                </Button>
              </Space>
            </Form>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
