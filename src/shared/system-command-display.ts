const THINKING_LEVEL_LABELS: Record<string, string> = {
  off: "关闭",
  minimal: "极简",
  low: "低",
  medium: "中",
  high: "高",
  adaptive: "自适应",
  xhigh: "极高",
};

const VERBOSE_LEVEL_LABELS: Record<string, string> = {
  off: "关闭",
  on: "开启",
  full: "完整",
};

const FAST_MODE_LABELS: Record<string, string> = {
  on: "开启",
  off: "关闭",
  status: "状态",
};

const REASONING_LEVEL_LABELS: Record<string, string> = {
  off: "关闭",
  on: "开启",
  stream: "流式",
};

const ELEVATED_LEVEL_LABELS: Record<string, string> = {
  off: "关闭",
  on: "开启",
  ask: "询问",
  full: "完整",
};

const EXEC_HOST_LABELS: Record<string, string> = {
  sandbox: "沙箱",
  gateway: "网关",
  node: "节点",
};

const EXEC_SECURITY_LABELS: Record<string, string> = {
  deny: "拒绝",
  allowlist: "白名单",
  full: "完整",
};

const EXEC_ASK_LABELS: Record<string, string> = {
  off: "关闭",
  "on-miss": "缺失时询问",
  always: "始终询问",
};

const QUEUE_MODE_LABELS: Record<string, string> = {
  interrupt: "打断",
  collect: "收集",
  followup: "跟进",
  steer: "转向",
  "steer-backlog": "转向积压",
  queue: "排队",
};

const QUEUE_DROP_LABELS: Record<string, string> = {
  old: "旧消息",
  new: "新消息",
  summarize: "总结",
};

const GROUP_ACTIVATION_LABELS: Record<string, string> = {
  mention: "提及时",
  always: "始终",
};

const USAGE_MODE_LABELS: Record<string, string> = {
  off: "关闭",
  tokens: "仅令牌",
  full: "完整",
  cost: "费用",
  inherit: "继承",
  allow: "开启",
  on: "开启",
};

const SEND_POLICY_LABELS: Record<string, string> = {
  on: "开启",
  off: "关闭",
  inherit: "继承",
};

function localizeValue(
  value: string | null | undefined,
  labels: Record<string, string>,
  fallback = "未知",
): string {
  const key = value?.trim().toLowerCase();
  if (!key) {
    return fallback;
  }
  return labels[key] ?? value!.trim();
}

export function localizeThinkingLevelLabel(value?: string | null): string {
  return localizeValue(value, THINKING_LEVEL_LABELS);
}

export function localizeVerboseLevelLabel(value?: string | null): string {
  return localizeValue(value, VERBOSE_LEVEL_LABELS);
}

export function localizeFastModeLabel(value?: string | null): string {
  return localizeValue(value, FAST_MODE_LABELS);
}

export function localizeReasoningLevelLabel(value?: string | null): string {
  return localizeValue(value, REASONING_LEVEL_LABELS);
}

export function localizeElevatedLevelLabel(value?: string | null): string {
  return localizeValue(value, ELEVATED_LEVEL_LABELS);
}

export function localizeExecHostLabel(value?: string | null): string {
  return localizeValue(value, EXEC_HOST_LABELS);
}

export function localizeExecSecurityLabel(value?: string | null): string {
  return localizeValue(value, EXEC_SECURITY_LABELS);
}

export function localizeExecAskLabel(value?: string | null): string {
  return localizeValue(value, EXEC_ASK_LABELS);
}

export function localizeQueueModeLabel(value?: string | null): string {
  return localizeValue(value, QUEUE_MODE_LABELS);
}

export function localizeQueueDropLabel(value?: string | null): string {
  return localizeValue(value, QUEUE_DROP_LABELS, "默认");
}

export function localizeGroupActivation(value?: string | null): string {
  return localizeValue(value, GROUP_ACTIVATION_LABELS);
}

export function localizeUsageModeLabel(value?: string | null): string {
  return localizeValue(value, USAGE_MODE_LABELS);
}

export function localizeSendPolicyLabel(value?: string | null): string {
  return localizeValue(value, SEND_POLICY_LABELS);
}

export function localizeToggleValue(value?: string | null): string {
  return localizeValue(value, { ...VERBOSE_LEVEL_LABELS, ...FAST_MODE_LABELS });
}

export function localizeRuntimeLabel(label: string): string {
  return label
    .split("/")
    .map((part) => {
      switch (part.trim().toLowerCase()) {
        case "direct":
          return "直连";
        case "docker":
          return "容器";
        case "all":
          return "全部";
        case "off":
          return "关闭";
        case "unknown":
          return "未知";
        default:
          return part;
      }
    })
    .join("/");
}

export function formatEnglishOptions(options: readonly string[] | string): string {
  if (typeof options === "string") {
    return options
      .split(",")
      .map((part: string) => part.trim())
      .filter(Boolean)
      .join("、");
  }
  return options.join("、");
}
