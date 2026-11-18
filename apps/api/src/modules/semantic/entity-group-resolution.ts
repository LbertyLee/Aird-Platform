import type { SemanticResolution } from './semantic.types';

/** Detect the requested scope only; membership must come from the model or evidence. */
export function entityGroupName(query: string): string | undefined {
  const groups: Array<[RegExp, string]> = [
    [/主要经济体|major economies/i, '主要经济体'],
    [/发达经济体|advanced economies/i, '发达经济体'],
    [/新兴经济体|emerging economies/i, '新兴经济体'],
    [/七国集团|\bg7\b/i, '七国集团'],
    [/二十国集团|\bg20\b/i, '二十国集团'],
    [/金砖国家|\bbrics\b/i, '金砖国家'],
  ];
  return groups.find(([pattern]) => pattern.test(query))?.[1];
}

export function entityGroupMembers(resolution: SemanticResolution): string[] {
  const labels = new Set(
    (resolution.entityGroups ?? []).map((group) => group.name),
  );
  return [
    ...new Set(
      [
        ...resolution.entities.map((entity) => entity.name),
        ...(resolution.discovery?.entities ?? []),
      ].filter((name) => !labels.has(name) && !entityGroupName(name)),
    ),
  ];
}

export function withEntityGroupScope(
  query: string,
  resolution: SemanticResolution,
): SemanticResolution {
  const name = entityGroupName(query);
  if (!name && !resolution.entityGroups?.length) return resolution;
  const initialGroups = resolution.entityGroups?.length
    ? resolution.entityGroups
    : [
        {
          name: name!,
          basis: '候选范围，成员及排名需由检索证据核实',
          members: entityGroupMembers(resolution),
        },
      ];
  const groups = initialGroups.map((group) => ({
    ...group,
    members:
      group.members.length || initialGroups.length > 1
        ? group.members
        : entityGroupMembers(resolution),
  }));
  const labels = new Set(groups.map((group) => group.name));
  const discovery = resolution.discovery;
  return {
    ...resolution,
    entityGroups: groups,
    // A collective label is not a row entity and must not become a literal filter.
    entities: resolution.entities.filter(
      (entity) => !labels.has(entity.name) && !entityGroupName(entity.name),
    ),
    discovery: {
      metrics: discovery?.metrics ?? [],
      entities: (discovery?.entities ?? []).filter(
        (entity) => !labels.has(entity) && !entityGroupName(entity),
      ),
      dimensions: discovery?.dimensions ?? [],
      dataNeeds: [
        ...new Set([
          ...(discovery?.dataNeeds ?? []),
          ...groups.map(
            (group) =>
              `核实${group.name}的成员范围和选择口径，候选成员不代表已验证的排名`,
          ),
        ]),
      ],
      websites: discovery?.websites ?? [],
    },
  };
}
