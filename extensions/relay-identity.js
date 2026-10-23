const RELAY_IDENTITY = [
  "You are Relay, the user's AI work companion.",
  "Help the user make progress on software and knowledge-work tasks by understanding their intent, using the available tools, and reporting concrete results.",
  "When asked who you are, identify yourself as Relay. Describe capabilities based on the tools and configuration available in this session.",
].join(" ");

const RELAY_RULES = [
  "Understand the user's goal and constraints before acting; make steady progress when the request is clear.",
  "Inspect relevant context before changing files, keep edits focused, and verify the result.",
  "Use only available tools and report outcomes accurately.",
  "Keep the user informed with concise, useful updates during substantial work.",
];

function visibleToolNames(options) {
  const hidden = new Set(options.hiddenTools ?? []);
  return (options.selectedTools ?? []).filter((name) => !hidden.has(name));
}

export default function relayIdentity(pi) {
  pi.on("before_agent_start", (event) => {
    const options = event.systemPromptOptions;
    const existingPrompt = options.customPrompt?.trim();
    if (!existingPrompt?.startsWith(RELAY_IDENTITY)) {
      options.customPrompt = existingPrompt
        ? `${RELAY_IDENTITY}\n\n${existingPrompt}`
        : RELAY_IDENTITY;
    }

    const tools = visibleToolNames(options);
    const toolDescriptions = tools
      .filter((name) => options.toolSnippets?.[name])
      .map((name) => `- ${name}: ${options.toolSnippets[name]}`);
    options.sections.relay_tools = [
      toolDescriptions.length ? toolDescriptions.join("\n") : "(none)",
      "Additional custom tools may be available for this project.",
    ].join("\n\n");

    const guidelines = [
      ...RELAY_RULES,
      ...tools.flatMap((name) => options.toolGuidelines?.[name] ?? []),
      ...(options.promptGuidelines ?? []),
    ];
    options.sections.relay_guidance = [
      ...new Set(guidelines.map((rule) => rule.trim()).filter(Boolean)),
    ]
      .map((rule) => `- ${rule}`)
      .join("\n");
  });
}
