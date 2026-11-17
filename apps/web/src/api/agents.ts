import { http } from './http';

export type AgentCategory = {
  code: string;
  name: string;
  sort: number;
};

export type AgentItem = {
  id: string;
  name: string;
  description: string;
  categoryCode: string;
  categoryName: string;
  author: string;
  icon: string | null;
  iconColor: string | null;
  usageCount: number;
  status: string;
  isPersonal: boolean;
};

export type CreateAgentPayload = {
  name: string;
  description: string;
  categoryCode: string;
  icon?: string;
  iconColor?: string;
};

export async function fetchAgentCategories() {
  const { data } = await http.get<AgentCategory[]>('/agents/categories');
  return data;
}

export async function fetchAgents(params?: {
  q?: string;
  categoryCode?: string;
}) {
  const { data } = await http.get<AgentItem[]>('/agents', { params });
  return data;
}

export async function createAgent(payload: CreateAgentPayload) {
  const { data } = await http.post<AgentItem>('/agents', payload);
  return data;
}

export async function updateAgent(id: string, payload: Partial<CreateAgentPayload>) {
  const { data } = await http.put<AgentItem>(`/agents/${id}`, payload);
  return data;
}

export async function deleteAgent(id: string) {
  await http.delete(`/agents/${id}`);
}
