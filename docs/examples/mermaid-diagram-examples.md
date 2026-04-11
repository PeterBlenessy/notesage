# Mermaid Diagram Examples

Examples of inline Mermaid diagrams using fenced code blocks. Type `/mermaid` in the editor or write a ```` ```mermaid ```` code block directly. The editor renders a live SVG preview — double-click to edit the source.

---

## 1. Simple Flowchart

A basic top-down decision flow.

```mermaid
graph TD
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Great!]
    B -->|No| D[Debug]
    D --> B
```

---

## 2. Left-to-Right Flowchart

Horizontal layout with subprocesses.

```mermaid
graph LR
    A[Input] --> B[Validate]
    B --> C{Valid?}
    C -->|Yes| D[Process]
    C -->|No| E[Return Error]
    D --> F[Store]
    F --> G[Response]
```

---

## 3. Sequence Diagram

API request flow between client and server.

```mermaid
sequenceDiagram
    participant Browser
    participant API
    participant DB

    Browser->>API: POST /login
    API->>DB: SELECT user
    DB-->>API: user record
    alt valid credentials
        API-->>Browser: 200 + JWT
    else invalid
        API-->>Browser: 401 Unauthorized
    end
```

---

## 4. Class Diagram

Object-oriented design with relationships.

```mermaid
classDiagram
    class Animal {
        +String name
        +int age
        +makeSound()
    }
    class Dog {
        +String breed
        +fetch()
    }
    class Cat {
        +bool indoor
        +purr()
    }
    Animal <|-- Dog
    Animal <|-- Cat
```

---

## 5. State Diagram

Document lifecycle states and transitions.

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Review: Submit
    Review --> Draft: Request Changes
    Review --> Approved: Approve
    Approved --> Published: Publish
    Published --> Archived: Archive
    Archived --> [*]
```

---

## 6. Entity-Relationship Diagram

Database schema for a blog.

```mermaid
erDiagram
    USER ||--o{ POST : writes
    USER {
        int id PK
        string name
        string email
    }
    POST ||--o{ COMMENT : has
    POST {
        int id PK
        string title
        text body
        int author_id FK
    }
    COMMENT {
        int id PK
        text body
        int post_id FK
        int user_id FK
    }
    USER ||--o{ COMMENT : writes
```

---

## 7. Gantt Chart

Project timeline with milestones.

```mermaid
gantt
    title Project Launch
    dateFormat YYYY-MM-DD
    section Design
        Wireframes       :done, d1, 2026-01-01, 14d
        Visual Design    :done, d2, after d1, 10d
    section Development
        Frontend         :active, dev1, 2026-01-25, 30d
        Backend          :dev2, 2026-01-25, 25d
        Integration      :dev3, after dev2, 10d
    section Launch
        QA Testing       :qa, after dev1, 14d
        Release          :milestone, after qa, 0d
```

---

## 8. Pie Chart

Survey results breakdown.

```mermaid
pie title Preferred Editor
    "VS Code" : 45
    "Neovim" : 20
    "IntelliJ" : 15
    "Sublime" : 10
    "Other" : 10
```

---

## 9. Git Graph

Branch and merge workflow.

```mermaid
gitGraph
    commit id: "init"
    branch feature
    commit id: "add login"
    commit id: "add auth"
    checkout main
    commit id: "hotfix"
    merge feature id: "merge feature"
    commit id: "release v1.0"
```

---

## 10. Mindmap

Brainstorming a product feature.

```mermaid
mindmap
    root((Notesage))
        Editor
            Rich text
            Markdown
            Code blocks
            Drawings
        AI
            Chat
            Agents
            Skills
            Tools
        Export
            PDF
            DOCX
            PPTX
            HTML
        Workspace
            Projects
            iCloud sync
            Git
```

---

## 11. User Journey

Onboarding experience mapping.

```mermaid
journey
    title New User Onboarding
    section Download
        Visit website: 5: User
        Download app: 4: User
        Install: 3: User
    section First Use
        Open app: 5: User
        Create project: 4: User
        Write first note: 5: User
    section AI Features
        Connect provider: 3: User
        First chat: 5: User
        Use agent: 4: User
```

---

## 12. Timeline

Product version history.

```mermaid
timeline
    title Notesage Releases
    2025-Q3 : v0.1 - Editor MVP
             : Tiptap integration
    2025-Q4 : v0.10 - AI Chat
             : Multi-provider support
    2026-Q1 : v0.20 - Agents & Skills
             : MCP integration
    2026-Q2 : v0.30 - Rich Content
             : Charts, drawings, tables
```

---

## 13. Flowchart with Subgraphs

Grouped nodes for visual organization.

```mermaid
graph TB
    subgraph Frontend
        A[React App] --> B[State Management]
        A --> C[Router]
    end
    subgraph Backend
        D[API Server] --> E[Auth]
        D --> F[Database]
    end
    A --> D
    B --> D
```

---

## 14. Sequence Diagram with Notes and Loops

Advanced sequence features: notes, loops, and parallel blocks.

```mermaid
sequenceDiagram
    actor User
    participant App
    participant Cache
    participant DB

    User->>App: Search query
    App->>Cache: Check cache
    alt cache hit
        Cache-->>App: Cached results
    else cache miss
        App->>DB: Query
        DB-->>App: Results
        App->>Cache: Store in cache
    end
    App-->>User: Display results

    loop Every 5 minutes
        Cache->>Cache: Evict expired entries
    end

    Note over App,DB: All queries are logged
```

---

## 15. Flowchart with Special Characters

Testing labels with quotes, parentheses, and symbols.

```mermaid
graph LR
    A["User Input (raw)"] --> B{"Valid?"}
    B -->|"Yes"| C["Process & Store"]
    B -->|"No"| D["Error: Invalid!"]
    C --> E[("Database")]
    D --> F["Log [warning]"]
```

---

## Tips

- **Theme:** Diagrams automatically match light/dark mode
- **Edit:** Double-click the rendered diagram to edit the source
- **Convert:** Click the pencil icon to convert flowcharts into editable Excalidraw drawings
- **AI:** Ask the AI chat to generate mermaid diagrams — all models support the syntax
- **Docs:** Full syntax reference at [mermaid.js.org](https://mermaid.js.org)