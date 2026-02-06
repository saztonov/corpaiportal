import React from 'react';
import { Form, Input, Button, notification } from 'antd';
import { supabase } from '@/shared/lib/supabase';
import { Link, useNavigate } from 'react-router-dom';

export const LoginForm = () => {
  const [loading, setLoading] = React.useState(false);
  const navigate = useNavigate();

  const onFinish = async (values: any) => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });

    if (error) {
      notification.error({
        message: 'Ошибка входа',
        description: error.message,
      });
    } else {
      notification.success({
        message: 'Вход выполнен успешно',
      });
      navigate('/chat', { replace: true });
    }
    setLoading(false);
  };

  return (
    <Form name="login" onFinish={onFinish} layout="vertical" requiredMark={false}>
      <Form.Item
        name="email"
        label="Email"
        rules={[{ required: true, type: 'email', message: 'Пожалуйста, введите корректный email!' }]}
      >
        <Input />
      </Form.Item>

      <Form.Item
        name="password"
        label="Пароль"
        rules={[{ required: true, message: 'Пожалуйста, введите пароль!' }]}
      >
        <Input.Password />
      </Form.Item>

      <Form.Item>
        <Button type="primary" htmlType="submit" loading={loading} block>
          Войти
        </Button>
      </Form.Item>
      <Form.Item style={{ textAlign: 'center' }}>
        Нет аккаунта? <Link to="/signup">Зарегистрироваться</Link>
      </Form.Item>
    </Form>
  );
};
