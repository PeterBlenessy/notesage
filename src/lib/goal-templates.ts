export interface GoalTemplate {
  id: string;
  name: string;
  description: string;
  content: string; // Full markdown template content (WITHOUT frontmatter)
}

export const GOAL_TEMPLATES: GoalTemplate[] = [
  {
    id: 'okr',
    name: 'OKR (Objectives & Key Results)',
    description:
      'Define objectives with measurable key results and track progress',
    content: `# [Project Name] OKRs

## Objective 1: [Describe your objective]

A clear, qualitative goal that defines what you want to achieve.

### Key Results

- [ ] Key Result: [Measurable key result, e.g., "Increase weekly active users to 5,000"]
- [ ] Key Result: [Measurable key result, e.g., "Reduce average response time to under 200ms"]
- [ ] Key Result: [Measurable key result, e.g., "Achieve 95% customer satisfaction score"]

### Action Items

- [ ] [Action item to support this objective]
- [ ] [Action item to support this objective]
- [ ] [Action item to support this objective]

## Objective 2: [Describe your objective]

A clear, qualitative goal that defines what you want to achieve.

### Key Results

- [ ] Key Result: [Measurable key result]
- [ ] Key Result: [Measurable key result]
- [ ] Key Result: [Measurable key result]

### Action Items

- [ ] [Action item to support this objective]
- [ ] [Action item to support this objective]
- [ ] [Action item to support this objective]

## Objective 3: [Describe your objective]

A clear, qualitative goal that defines what you want to achieve.

### Key Results

- [ ] Key Result: [Measurable key result]
- [ ] Key Result: [Measurable key result]

### Action Items

- [ ] [Action item to support this objective]
- [ ] [Action item to support this objective]
`,
  },
  {
    id: 'checklist',
    name: 'Simple Checklist',
    description: 'A straightforward list of goals with checkboxes',
    content: `# [Project Name] Goals

- [ ] [Your goal here]
- [ ] [Your goal here]
- [ ] [Your goal here]
- [ ] [Your goal here]
- [ ] [Your goal here]
- [ ] [Your goal here]
`,
  },
  {
    id: 'smart',
    name: 'SMART Goals',
    description:
      'Structured goals that are Specific, Measurable, Achievable, Relevant, and Time-bound',
    content: `# [Project Name] SMART Goals

## Goal 1: [Your goal title]

### Specific

What exactly do you want to accomplish? Be precise and clear.

[Describe the specific outcome you want to achieve]

### Measurable

How will you measure success? What metrics or indicators will you use?

[Define the quantitative or qualitative measures]

### Achievable

Is this goal realistic given your resources and constraints?

[Explain why this goal is attainable and what resources you have]

### Relevant

Why does this goal matter? How does it align with your broader objectives?

[Describe why this goal is important and how it connects to the bigger picture]

### Time-bound

What is your deadline? What are the key milestones along the way?

[Set a target date and intermediate checkpoints]

### Action Items

- [ ] [Action item to achieve this goal]
- [ ] [Action item to achieve this goal]
- [ ] [Action item to achieve this goal]

---

## Goal 2: [Your goal title]

### Specific

[Describe the specific outcome you want to achieve]

### Measurable

[Define the quantitative or qualitative measures]

### Achievable

[Explain why this goal is attainable and what resources you have]

### Relevant

[Describe why this goal is important and how it connects to the bigger picture]

### Time-bound

[Set a target date and intermediate checkpoints]

### Action Items

- [ ] [Action item to achieve this goal]
- [ ] [Action item to achieve this goal]
- [ ] [Action item to achieve this goal]
`,
  },
  {
    id: 'milestones',
    name: 'Milestone Tracker',
    description: 'Phase-based goals with milestones and status tracking',
    content: `# [Project Name] Milestones

**Status Legend:**

> - Complete
> - In Progress
> - Not Started

---

## Phase 1: [Phase Name]

**Status:** Not Started

[Describe the goals and scope of this phase]

### Milestones

- [ ] [Milestone description]
- [ ] [Milestone description]
- [ ] [Milestone description]

---

## Phase 2: [Phase Name]

**Status:** Not Started

[Describe the goals and scope of this phase]

### Milestones

- [ ] [Milestone description]
- [ ] [Milestone description]
- [ ] [Milestone description]

---

## Phase 3: [Phase Name]

**Status:** Not Started

[Describe the goals and scope of this phase]

### Milestones

- [ ] [Milestone description]
- [ ] [Milestone description]
- [ ] [Milestone description]
`,
  },
];

export function getGoalTemplate(id: string): GoalTemplate | undefined {
  return GOAL_TEMPLATES.find((t) => t.id === id);
}
