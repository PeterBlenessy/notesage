# Diagram Examples

Complete Mermaid source examples ready to use. Each example includes the `.mmd` file content and the markdown line to insert (after rendering to SVG).

---

## Example 1: Flowchart — CI/CD Pipeline

**Mermaid source** (`.notesage/diagrams/cicd-example.mmd`):
```mermaid
graph LR
    A[Push to Main] --> B[Run Tests]
    B --> C{Tests Pass?}
    C -->|Yes| D[Build Docker Image]
    C -->|No| E[Notify Developer]
    D --> F[Deploy to Staging]
    F --> G{Manual Approval?}
    G -->|Approved| H[Deploy to Production]
    G -->|Rejected| E
    E --> I[Fix & Retry]
    I --> A
```

**Markdown to insert (after rendering):**
```markdown
![diagram](/.notesage/diagrams/cicd-example.svg)
```

---

## Example 2: Sequence Diagram — Authentication Flow

**Mermaid source** (`.notesage/diagrams/auth-flow-example.mmd`):
```mermaid
sequenceDiagram
    participant U as User
    participant C as Client App
    participant A as Auth Server
    participant R as Resource Server

    U->>C: Enter credentials
    C->>A: POST /auth/login
    activate A
    A-->>C: JWT token + refresh token
    deactivate A
    C->>C: Store tokens
    C-->>U: Login successful

    U->>C: Request data
    C->>R: GET /api/data (Bearer token)
    activate R
    R-->>C: 200 OK + data
    deactivate R
    C-->>U: Display data

    Note over C,A: Token expires after 15 minutes

    U->>C: Request more data
    C->>R: GET /api/data (expired token)
    R-->>C: 401 Unauthorized
    C->>A: POST /auth/refresh
    activate A
    A-->>C: New JWT token
    deactivate A
    C->>R: GET /api/data (new token)
    R-->>C: 200 OK + data
```

**Markdown to insert (after rendering):**
```markdown
![diagram](/.notesage/diagrams/auth-flow-example.svg)
```

---

## Example 3: Class Diagram — Plugin System

**Mermaid source** (`.notesage/diagrams/plugin-system-example.mmd`):
```mermaid
classDiagram
    class Plugin {
        <<interface>>
        +String name
        +String version
        +activate() void
        +deactivate() void
    }
    class EditorPlugin {
        +String name
        +String version
        +Editor editor
        +activate() void
        +deactivate() void
        +onDocumentChange(doc) void
    }
    class ThemePlugin {
        +String name
        +String version
        +Map colors
        +activate() void
        +deactivate() void
        +getStylesheet() String
    }
    class PluginManager {
        -Plugin[] plugins
        +register(plugin) void
        +unregister(name) void
        +getPlugin(name) Plugin
        +activateAll() void
    }
    class PluginConfig {
        +String pluginName
        +Map settings
        +validate() boolean
    }

    Plugin <|.. EditorPlugin
    Plugin <|.. ThemePlugin
    PluginManager "1" --> "*" Plugin : manages
    Plugin "1" --> "0..1" PluginConfig : configured by
```

**Markdown to insert (after rendering):**
```markdown
![diagram](/.notesage/diagrams/plugin-system-example.svg)
```

---

## Example 4: State Diagram — Order Lifecycle

**Mermaid source** (`.notesage/diagrams/order-lifecycle-example.mmd`):
```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Submitted : submit
    Submitted --> Processing : accept
    Submitted --> Cancelled : cancel

    state Processing {
        [*] --> Validating
        Validating --> Picking : validated
        Picking --> Packing : picked
        Packing --> [*]
    }

    Processing --> Shipped : dispatch
    Shipped --> Delivered : confirm_delivery
    Delivered --> [*]

    Shipped --> Returned : return_request
    Returned --> Refunded : process_refund
    Refunded --> [*]

    Cancelled --> [*]
```

**Markdown to insert (after rendering):**
```markdown
![diagram](/.notesage/diagrams/order-lifecycle-example.svg)
```

---

## Example 5: ER Diagram — Blog Schema

**Mermaid source** (`.notesage/diagrams/blog-schema-example.mmd`):
```mermaid
erDiagram
    USER ||--o{ POST : writes
    USER ||--o{ COMMENT : writes
    POST ||--o{ COMMENT : has
    POST }o--o{ TAG : tagged_with
    CATEGORY ||--o{ POST : contains

    USER {
        int id PK
        string username UK
        string email UK
        string password_hash
        datetime created_at
    }
    POST {
        int id PK
        int author_id FK
        int category_id FK
        string title
        text body
        string status
        datetime published_at
    }
    COMMENT {
        int id PK
        int post_id FK
        int author_id FK
        text body
        datetime created_at
    }
    TAG {
        int id PK
        string name UK
        string slug UK
    }
    CATEGORY {
        int id PK
        string name
        string slug UK
    }
```

**Markdown to insert (after rendering):**
```markdown
![diagram](/.notesage/diagrams/blog-schema-example.svg)
```

---

## Example 6: Gantt Chart — Sprint Plan

**Mermaid source** (`.notesage/diagrams/sprint-plan-example.mmd`):
```mermaid
gantt
    title Sprint 12 Plan
    dateFormat YYYY-MM-DD
    axisFormat %b %d

    section Backend
        API redesign        :done, api, 2025-03-03, 5d
        Database migration   :active, db, after api, 3d
        Cache layer          :cache, after db, 4d

    section Frontend
        Component library    :done, comp, 2025-03-03, 4d
        Dashboard UI         :active, dash, after comp, 6d
        Mobile responsive    :mob, after dash, 3d

    section QA
        Integration tests    :test, after cache, 4d
        Performance testing  :perf, after test, 2d
        Release              :milestone, rel, after perf, 0d
```

**Markdown to insert (after rendering):**
```markdown
![diagram](/.notesage/diagrams/sprint-plan-example.svg)
```
