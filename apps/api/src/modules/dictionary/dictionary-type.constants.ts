/** 系统内置字典类型编码（业务逻辑依赖这些固定值） */
export const SYSTEM_DICT_CODES = {
  country_region: 'country_region',
  organization: 'organization',
  industry: 'industry',
  unit: 'unit',
  time_granularity: 'time_granularity',
  indicator_category: 'indicator_category',
  source_category: 'source_category',
  /** 智能体分类（用户端创建智能体与管理端维护共用） */
  agent_category: 'agent_category',
  /** 知识库分组（管理端知识库列表 / 文档侧栏） */
  knowledge_group: 'knowledge_group',
  /** 用户协议与隐私政策版本信息（用户端注册页展示） */
  legal_documents: 'legal_documents',
} as const;

export type SystemDictCode =
  (typeof SYSTEM_DICT_CODES)[keyof typeof SYSTEM_DICT_CODES];

/** 内置类型种子数据 */
export const SYSTEM_DICT_TYPE_SEEDS: Array<{
  code: SystemDictCode;
  name: string;
  description: string;
  sort: number;
}> = [
  {
    code: SYSTEM_DICT_CODES.country_region,
    name: '国家地区',
    description: '国家与地区',
    sort: 10,
  },
  {
    code: SYSTEM_DICT_CODES.organization,
    name: '机构',
    description: '数据来源机构',
    sort: 20,
  },
  {
    code: SYSTEM_DICT_CODES.industry,
    name: '行业',
    description: '行业分类',
    sort: 30,
  },
  {
    code: SYSTEM_DICT_CODES.unit,
    name: '单位',
    description: '计量单位',
    sort: 40,
  },
  {
    code: SYSTEM_DICT_CODES.time_granularity,
    name: '时间粒度',
    description: '时间粒度',
    sort: 50,
  },
  {
    code: SYSTEM_DICT_CODES.indicator_category,
    name: '指标分类',
    description: '标准指标分类',
    sort: 60,
  },
  {
    code: SYSTEM_DICT_CODES.source_category,
    name: '来源分类',
    description: '数据来源类型（国际组织/统计局/政府机构等）',
    sort: 70,
  },
  {
    code: SYSTEM_DICT_CODES.agent_category,
    name: '智能体分类',
    description: '智能体中心的分类选项',
    sort: 75,
  },
  {
    code: SYSTEM_DICT_CODES.knowledge_group,
    name: '知识分组',
    description: '知识库管理侧栏分组（平台知识库与文档归类）',
    sort: 80,
  },
  {
    code: SYSTEM_DICT_CODES.legal_documents,
    name: '用户协议与隐私政策',
    description: '用户端注册页展示的协议正文及版本信息',
    sort: 90,
  },
];

/** 用户协议与隐私政策正文及版本元信息 */
export const LEGAL_DOCUMENT_SEEDS: Array<{
  code: string;
  name: string;
  description: string;
  sort: number;
  defaultValue: string;
}> = [
  {
    code: 'user_agreement_version',
    name: '用户协议版本号',
    description: '用户协议版本号，可直接在字典项名称中维护',
    sort: 20,
    defaultValue: 'V1.0',
  },
  {
    code: 'user_agreement_updated_at',
    name: '用户协议更新日期',
    description: '用户协议更新日期，格式 YYYY-MM-DD，可直接在字典项名称中维护',
    sort: 30,
    defaultValue: '2026-10-26',
  },
  {
    code: 'user_agreement_effective_at',
    name: '用户协议生效日期',
    description: '用户协议生效日期，格式 YYYY-MM-DD，可直接在字典项名称中维护',
    sort: 40,
    defaultValue: '2026-10-26',
  },
  {
    code: 'privacy_policy_version',
    name: '隐私政策版本号',
    description: '隐私政策版本号，可直接在字典项名称中维护',
    sort: 50,
    defaultValue: 'V1.0',
  },
  {
    code: 'privacy_policy_updated_at',
    name: '隐私政策更新日期',
    description: '隐私政策更新日期，格式 YYYY-MM-DD，可直接在字典项名称中维护',
    sort: 60,
    defaultValue: '2026-10-26',
  },
  {
    code: 'privacy_policy_effective_at',
    name: '隐私政策生效日期',
    description: '隐私政策生效日期，格式 YYYY-MM-DD，可直接在字典项名称中维护',
    sort: 70,
    defaultValue: '2026-10-26',
  },
  {
    code: 'user_agreement_content',
    name: '用户协议正文',
    description: '用户协议完整正文（HTML），支持 p、h2、strong 等基础标签',
    sort: 80,
    defaultValue: '',
  },
  {
    code: 'privacy_policy_content',
    name: '隐私政策正文',
    description: '隐私政策完整正文（HTML），支持 p、h2、strong 等基础标签',
    sort: 90,
    defaultValue: '',
  },
];

/** 来源分类预置项 */
export const SOURCE_CATEGORY_SEEDS: Array<{
  code: string;
  name: string;
  sort: number;
}> = [
  { code: 'intl_org', name: '国际组织', sort: 10 },
  { code: 'national_stats', name: '各国统计局', sort: 20 },
  { code: 'cn_gov', name: '中国政府机构', sort: 30 },
];

/** 智能体分类预置项 */
export const AGENT_CATEGORY_SEEDS: Array<{
  code: string;
  name: string;
  sort: number;
}> = [
  { code: 'learning', name: '学习', sort: 10 },
  { code: 'writing', name: '写作', sort: 20 },
  { code: 'entertainment', name: '娱乐', sort: 30 },
  { code: 'workplace', name: '职场', sort: 40 },
  { code: 'ai_tools', name: 'AI工具', sort: 50 },
  { code: 'public_config', name: '公开配置', sort: 60 },
  { code: 'other', name: '其他', sort: 999 },
];

/** 用户端上传文档使用的默认知识分组编码 */
export const DEFAULT_KNOWLEDGE_GROUP_CODE = 'default';

/** 知识分组预置项 */
export const KNOWLEDGE_GROUP_SEEDS: Array<{
  code: string;
  name: string;
  nameEn?: string;
  sort: number;
}> = [
  {
    code: DEFAULT_KNOWLEDGE_GROUP_CODE,
    name: '默认分组',
    nameEn: 'Default',
    sort: 10,
  },
  {
    code: 'macro_research',
    name: '宏观研究',
    nameEn: 'Macro Research',
    sort: 20,
  },
  {
    code: 'industry_research',
    name: '行业研究',
    nameEn: 'Industry Research',
    sort: 30,
  },
  { code: 'topic_data', name: '专题数据', nameEn: 'Topic Data', sort: 40 },
];
