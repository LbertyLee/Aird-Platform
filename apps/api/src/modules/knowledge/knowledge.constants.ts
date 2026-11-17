/**
 * 用户补充数据知识库：每人一份私有库（免审），搜索上传默认入库。
 * 历史全局库 code 仍为 `user-supplement-data`；个人库为 `user-supplement-data:{userId}`。
 */
export const USER_SUPPLEMENT_LIBRARY_CODE = 'user-supplement-data';
export const USER_SUPPLEMENT_LIBRARY_NAME = '用户补充数据知识库';
export const USER_SUPPLEMENT_LIBRARY_INTRO =
  '您通过搜索上传的补充资料默认入库；私有知识库，免审核，上传后自动学习建索引。';

/** 个人补充库编码 */
export function userSupplementLibraryCode(userId: string) {
  return `${USER_SUPPLEMENT_LIBRARY_CODE}:${userId}`;
}

/** 是否补充数据知识库（含历史全局库与个人库） */
export function isUserSupplementLibraryCode(code: string) {
  return (
    code === USER_SUPPLEMENT_LIBRARY_CODE ||
    code.startsWith(`${USER_SUPPLEMENT_LIBRARY_CODE}:`)
  );
}
