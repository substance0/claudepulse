# ClaudePulse Application Workflow Diagrams

This document presents the functional workflows of the ClaudePulse application using Mermaid diagrams.

## System Overview

**Quick understanding:** ClaudePulse automatically maintains your Claude Pro/Max session by sending periodic pulse messages.

```mermaid
graph LR
    Start([Start]) --> Auth[Authenticate<br/>Claude CLI OAuth]
    Auth --> Schedule[Calculate Next Pulse<br/>Strategy-based scheduling]
    Schedule --> Wait[Wait Until Time]
    Wait --> Send[Send Pulse Message]
    Send --> Parse{Parse Response}
    Parse -->|Success| Schedule
    Parse -->|Cycle Limit Detected| UpdateSchedule[Update Schedule<br/>from reset time]
    Parse -->|Error| Retry[Retry with Backoff]
    UpdateSchedule --> Schedule
    Retry --> Send

    style Start fill:#e1f5fe
    style Auth fill:#fff3e0
    style Schedule fill:#e8f5e9
    style Wait fill:#f3e5f5
    style Send fill:#fff9c4
    style Parse fill:#e0f2f1
    style UpdateSchedule fill:#ffe0b2
    style Retry fill:#ffebee
```

**Key Points:**

- **Adaptive Scheduling**: 1-hour discovery mode → 5-hour normal operation
- **Cycle Limit Aware**: Automatically adjusts schedule when Claude reports "5-hour limit reached • resets 2pm"
- **Resilient**: Exponential backoff, credential watching, state persistence

See detailed workflows below ↓

## Table of Contents

- [ClaudePulse Application Workflow Diagrams](#claudepulse-application-workflow-diagrams)
  - [System Overview](#system-overview)
  - [Table of Contents](#table-of-contents)
  - [1. Main Application Workflow](#1-main-application-workflow)
  - [2. Scheduler Workflow](#2-scheduler-workflow)
  - [3. Scheduling Strategy Selection](#3-scheduling-strategy-selection)
    - [Strategy Priority Table](#strategy-priority-table)
    - [First Run vs Subsequent Run Behavior](#first-run-vs-subsequent-run-behavior)
  - [4. Cycle Limit Handling Workflow](#4-cycle-limit-handling-workflow)
  - [5. Session Tracking Workflow](#5-session-tracking-workflow)
  - [6. Error Handling and Recovery](#6-error-handling-and-recovery)
  - [7. Configuration Loading and Validation](#7-configuration-loading-and-validation)
  - [Master System Architecture](#master-system-architecture)
  - [Component Interaction Overview](#component-interaction-overview)
  - [Key Design Principles](#key-design-principles)

## 1. Main Application Workflow

**Simplified view** - See [Error Handling and Recovery](#6-error-handling-and-recovery) for detailed error flows.

```mermaid
graph TD
    A["`**Application Start**`"] --> B["`**Load & Validate Config**
    _Environment variables + defaults_`"]

    B --> C["`**Create Scheduler**
    _Initialize automation engine_`"]

    C --> D["`**Start Scheduler**
    _Test authentication_`"]

    D --> E{"`**Start Success?**`"}

    E -->|"✗ Auth Failed"| F["`**Watch Credentials**
    _Auto-recovery on file change_`"]
    F --> G{"`**Credentials Updated?**`"}
    G -->|"Yes"| D
    G -->|"No"| F

    E -->|"✗ Other Error"| H{"`**KEEP_PULSE_ON_FAILURE?**`"}
    H -->|"Yes"| I["`**Hold Process**
    _Debug mode_`"]
    H -->|"No"| J["`**Exit**
    _Graceful failure_`"]

    E -->|"✓ Success"| K{"`**DRY_RUN Mode?**`"}

    K -->|"Yes"| L["`**Exit Early**
    _Config test complete_`"]

    K -->|"No"| M["`**Setup Handlers**
    _Shutdown & error handling_`"]

    M --> N["`**Application Running**
    _5-hour pulse automation active_`"]

    N --> O["`**Graceful Shutdown**
    _On SIGINT/SIGTERM_`"]

    %% Annotations
    NOTE_AUTH["`**Authentication Recovery**
    _• Monitors ~/.claude/ for credential changes
    • Automatic retry when file updated
    • Preserves lastScheduledTime across failures
    • No manual intervention required_`"]

    NOTE_ERROR["`**Error Handling**
    _• Network errors: exponential backoff retry
    • Process errors: smart recovery analysis
    • Auth failures: credential watch mode
    • All errors preserve scheduling state_`"]

    NOTE_ARCH["`**Architecture**
    _• Single scheduler instance
    • Event-driven with timers
    • ~1 API call per 5-hour cycle
    • Minimal memory footprint_`"]

    F -.->|"Recovery"| NOTE_AUTH
    H -.->|"Errors"| NOTE_ERROR
    N -.->|"Design"| NOTE_ARCH
```

## 2. Scheduler Workflow

```mermaid
graph TD
    A["`**Scheduler Start**
    _Begin pulse cycle_`"] --> B["`**Update Session Tracking**
    _Scan JSONL files for activity_`"]

    B --> C["`**Compute Next Run Time**
    _Use scheduling strategies_`"]

    C --> D["`**Schedule Keepalive**
    _Set timer for next execution_`"]

    D --> E["`**Wait for Schedule**
    _Timer countdown (up to 5h)_`"]

    E --> F["`**Execute Keepalive Cycle**
    _Send 'pulse check' to Claude CLI_`"]

    F --> G{"`**Success?**
    _CLI exit code check_`"}

    G -->|"✓ Success"| H["`**Reset Failure Count**
    _Clear consecutive failures_`"]

    G -->|"✗ Failed"| I["`**Handle Failure**
    _Analyze error response_`"]

    H --> J["`**Update Last Success Time**
    _Record successful pulse_`"]

    I --> K{"`**Cycle Limit Reached?**
    _5-hour limit reached message_`"}

    K -->|"Yes"| L["`**Parse Cycle Limit Info**
    _Extract reset time_`"]

    K -->|"✗ Other Error"| M["`**Increment Failure Count**
    _Track consecutive failures_`"]

    L --> N["`**Schedule at Reset Time**
    _Wait until limit resets_`"]

    M --> O{"`**Max Retries Reached?**
    _Usually 3 attempts_`"}

    O -->|"Continue"| P["`**Exponential Backoff**
    _Wait longer before retry_`"]

    O -->|"Give Up"| Q["`**Log Critical Failure**
    _Alert but continue scheduling_`"]

    P --> C
    N --> C
    J --> C
    Q --> C

    %% Annotations
    NOTE3["`Performance Impact
    _Each cycle consumes ~1 API call
    Cycle limits are expected behavior_`"]

    NOTE4["`**Reliability Design**
    _Never stops trying to schedule
    Failures don't break the cycle_`"]

    K -.->|"Expected behavior"| NOTE3
    Q -.->|"Fault tolerance"| NOTE4

    %% Consistent styling
    style A fill:#e1f5fe
    style H fill:#e8f5e9
    style J fill:#e8f5e9
    style K fill:#f3e5f5
    style L fill:#ffe0b2
    style M fill:#ffebee
    style P fill:#fff3e0
    style Q fill:#ffebee
```

## 3. Scheduling Strategy Selection

### Strategy Priority Table

Strategies are evaluated in priority order. The first applicable strategy determines the next run time.

| Priority | Strategy        | When Applicable                                     | Next Run Time                  | Example                              |
| -------- | --------------- | --------------------------------------------------- | ------------------------------ | ------------------------------------ |
| **1**    | Reset Signal    | Cycle limit message received                        | Reset time + 10sec             | "resets 2pm" → 14:00:10              |
| **2**    | Scheduled Start | `SCHEDULED_START_HOUR` set + no `lastScheduledTime` | `SCHEDULED_START_HOUR` + 10sec | `SCHEDULED_START_HOUR=14` → 14:00:10 |
| **3**    | Active Cycle    | Active session window detected                      | Window end + 10sec             | Active session ends 19:00 → 19:00:10 |
| **4**    | Cruise          | Has `lastScheduledTime` + cycle detected            | Last time + 5 hours            | Last: 09:00:10 → Next: 14:00         |
| **5**    | Discovery       | Fallback (no other strategy applies)                | Next hour + 10sec              | Current: 13:45 → Next: 14:00:10      |

**Key Points:**

- **Reset Signal** (Priority 1) overrides all others when a cycle limit is detected
- **Scheduled Start** (Priority 2) only applies to the **first pulse** when starting fresh
- **Active Cycle** (Priority 3) detects mid-cycle container restarts and schedules at cycle expiry
- **Cruise** (Priority 4) activates after cycle detection, maintains 5-hour intervals
- **Discovery** (Priority 5) continues hourly pulses until cycle limit message received
- All times are in container's local timezone (set via `TZ` environment variable)
- All strategies include a 10-second buffer to ensure pulse happens after time boundary

### First Run vs Subsequent Run Behavior

Understanding the difference between first run and subsequent runs helps clarify strategy selection:

```mermaid
graph TB
    subgraph FIRST ["First Run (No lastScheduledTime)"]
        A1["`**Start ClaudePulse**
        _Fresh installation_`"] --> B1{"`**SCHEDULED_START_HOUR set?**
        _Environment variable_`"}

        B1 -->|"✓ Yes"| C1["`**Scheduled Start Strategy**
        _Align to configured hour_`"]
        C1 --> D1["`**Schedule at SCHEDULED_START_HOUR + 10sec**
        _Example: 14:00:10_`"]

        B1 -->|"✗ No"| E1{"`**Active Cycle detected?**
        _Active Claude session found_`"}

        E1 -->|"✓ Yes"| F1["`**Active Cycle Strategy**
        _Use detected window end_`"]
        F1 --> G1["`**Schedule at Window End + 10sec**
        _Example: 19:00:10_`"]

        E1 -->|"✗ No"| H1["`**Discovery Strategy**
        _Safe fallback_`"]
        H1 --> I1["`**Schedule at Next Hour + 10sec**
        _Example: 14:00:10_`"]

        D1 --> J1["`**Execute Pulse**
        _Send message to Claude_`"]
        G1 --> J1
        I1 --> J1

        J1 --> K1["`**Record lastScheduledTime**
        _Transition to Cruise (after cycle detected)_`"]

        style A1 fill:#fff3e0
        style C1 fill:#e8f5e9
        style F1 fill:#e1f5fe
        style H1 fill:#f3e5f5
    end

    subgraph SUBSEQUENT ["Subsequent Runs (Has lastScheduledTime)"]
        A2["`**ClaudePulse Running**
        _Normal operation_`"] --> B2{"`**Cycle limit detected?**
        _'5-hour limit reached • resets 2pm'_`"}

        B2 -->|"✓ Yes"| C2["`**Reset Signal Strategy**
        _Highest priority override_`"]
        C2 --> D2["`**Schedule at Reset Time + 10sec**
        _Example: 14:00:10_`"]

        B2 -->|"✗ No"| E2["`**Cruise Strategy**
        _Most common case_`"]
        E2 --> F2["`**Schedule at Last + 5 Hours**
        _Example: 09:00:10 → 14:00:10_`"]

        D2 --> G2["`**Execute Pulse**
        _Consistent 5-hour intervals_`"]
        F2 --> G2

        G2 --> H2["`**Update lastScheduledTime**
        _Maintain schedule state_`"]

        H2 --> A2

        style A2 fill:#e8f5e9
        style C2 fill:#ffebee
        style E2 fill:#e1f5fe
    end

    K1 -.->|"Becomes"| A2
```

**Key Differences:**

| Aspect               | First Run                                  | Subsequent Runs                       |
| -------------------- | ------------------------------------------ | ------------------------------------- |
| **Primary Strategy** | Scheduled Start / Active Cycle / Discovery | Cruise (every 5 hours)                |
| **Schedule State**   | No `lastScheduledTime` yet                 | Has `lastScheduledTime`               |
| **Behavior**         | Tries to discover current cycle boundaries | Maintains consistent 5-hour intervals |
| **Override**         | Reset Signal only                          | Reset Signal only                     |

```mermaid
graph TD
    A["`**Schedule Request**
    _Determine next pulse time_`"] --> B{"`**Reset Signal?**
    _Cycle limit reset signal_`"}

    B -->|"✓ Yes"| C["`**Reset Signal Strategy**
    _Highest priority scheduling_`"]
    C --> D["`**Align to Hour + 10sec**
    _Schedule at reset time + buffer_`"]
    D --> E["`**Schedule Execution**
    _Timer set for calculated time_`"]

    B -->|"✗ No"| F{"`**Has Last Scheduled Time?**
    _Previous pulse exists_`"}

    F -->|"✓ Yes"| G["`**Cruise Strategy**
    _Maintain 5-hour intervals_`"]
    G --> H["`**Last Time + 5 Hours**
    _Consistent scheduling pattern_`"]
    H --> E

    F -->|"✗ No"| I{"`**Initial Pulse Hour Configured?**
    _SCHEDULED_START_HOUR environment variable_`"}

    I -->|"✓ Yes"| J["`Scheduled Start Strategy
    _First pulse only - align to configured hour_`"]
    J --> K["`**Next SCHEDULED_START_HOUR + 10sec**
    _e.g., SCHEDULED_START_HOUR=14 → 14:00:10 local time_`"]
    K --> E

    I -->|"✗ No"| L["`**Active Cycle Strategy**
    _Use Claude session data_`"]
    L --> M["`**Update Session Tracking**
    _Scan JSONL files for activity_`"]
    M --> N{"`**Active Cycle Available?**
    _Active 5-hour window found_`"}

    N -->|"✓ Yes"| O["`**Cycle Expiry + 10sec**
    _Schedule after current window_`"]
    N -->|"✗ No"| P["`Discovery Strategy
    _First-run fallback_`"]
    O --> E
    P --> Q["`**Next Hour + 10sec**
    _Safe default scheduling_`"]
    Q --> E

    %% Strategy annotations
    NOTE_EXT["`**Reset Signal Priority**
    _Overrides all other strategies
    Uses precise reset time from Claude
    Always includes 10-second buffer_`"]

    NOTE_RESET["`SCHEDULED_START_HOUR Configuration
    _Example: SCHEDULED_START_HOUR=14 → first pulse at 14:00:10
    Only applies to first pulse when no schedule exists
    Subsequent pulses use Cruise (every 5h after cycle detected)
    Use when you know the next cycle start time_`"]

    NOTE_CADENCE["`**Cruise Behavior**
    _Preserves exact 5-hour intervals
    Most predictable scheduling pattern
    Activates after cycle detection_`"]

    C -.->|"Highest priority"| NOTE_EXT
    J -.->|"Configuration"| NOTE_RESET
    G -.->|"Predictable timing"| NOTE_CADENCE

    %% Consistent styling
    style A fill:#e1f5fe
    style C fill:#ffe0b2
    style E fill:#e8f5e9
    style G fill:#e8f5e9
    style J fill:#fff3e0
    style L fill:#e1f5fe
```

## 4. Cycle Limit Handling Workflow

```mermaid
%% This is a comment explaining the flow
graph TD
    A[Claude CLI Call Failed] --> B[Parse Error Message]
    B --> C{Auth Error?}
    C -->|Yes| D[Return No Cycle Limit]
    C -->|No| E[Check Claude Cycle Limit Format]
    E --> F{"#quot;5-hour limit reached ∙ resets Xpm#quot;?"}
    F -->|Yes| G[Parse Reset Hour]
    F -->|No| H[Return No Cycle Limit]
    G --> I[Convert to 24-hour Format]
    I --> J[Calculate Reset Time]
    J --> K[Schedule at Reset Time + Buffer]
    H --> L[Handle as Normal Error]

    %% Consistent styling
    style A fill:#ffebee
    style C fill:#f3e5f5
    style D fill:#e8f5e9
    style F fill:#f3e5f5
    style G fill:#e1f5fe
    style K fill:#e8f5e9
    style L fill:#ffebee
```

## 5. Session Tracking Workflow

```mermaid
graph TD
    A["`**Session Tracking Update**
    _Scan for Claude activity_`"] --> B["`**Scan Project Directories**
    _Look for .claude/messages/`"]

    B --> C["`**Read JSONL Files**
    _Parse session message logs_`"]

    C --> D{"`**Files Found?**
    _Any active sessions?_`"}

    D -->|"✗ No Files"| E["`**Return No Sessions**
    _No Claude activity detected_`"]

    D -->|"✓ Found Files"| F["`**Parse Message Lines**
    _Extract JSON objects_`"]

    F --> G["`**Extract & Normalize Timestamps**
    _Smart timezone detection_`"]

    G --> H["`**Build Session Blocks**
    _Group by 5-hour windows_`"]

    H --> I["`**Find Current Active Block**
    _Most recent session window_`"]

    I --> J{"`**Active Block Found?**
    _Recent activity detected?_`"}

    J -->|"✓ Active Session"| K["`**Calculate Block Expiry**
    _Determine 5-hour window end_`"]

    J -->|"✗ No Activity"| L["`**Return No Expiry**
    _No active sessions_`"]

    K --> M["`**Apply Timezone Handling**
    _Ensure UTC consistency_`"]

    M --> N["`**Return Session Expiry**
    _Next scheduling anchor_`"]

    E --> O["`**Update Tracking Status**
    _Log session summary_`"]
    L --> O
    N --> O

    %% Annotations for improved timezone handling
    NOTE5["`Smart Timestamp Processing
    _• Detects 5+ timestamp formats
    • ISO with/without timezone
    • Unix timestamps (sec/ms)
    • Assumes UTC for ambiguous formats_`"]

    NOTE6["`**Timezone Assumptions**
    _• ISO without timezone → UTC
    • Date-only → UTC midnight
    • Unknown formats → Warning logged
    • All calculations in UTC_`"]

    G -.->|"Format detection"| NOTE5
    M -.->|"Assumptions"| NOTE6

    %% Consistent styling
    style A fill:#e1f5fe
    style D fill:#f3e5f5
    style J fill:#f3e5f5
    style K fill:#e8f5e9
    style N fill:#e8f5e9
```

## 6. Error Handling and Recovery

```mermaid
graph TD
    A[Error Detected] --> B{Error Type}
    B -->|Authentication| C[Mark Auth Failure]
    B -->|Cycle Limit| D[Parse Cycle Limit Info]
    B -->|Network| E[Network Error Handler]
    B -->|Process| F[Process Error Handler]

    C --> G[Start Credentials Watcher]
    G --> H[Wait for New Credentials]
    H --> I[Retry Authentication]
    I --> J{Auth Success?}
    J -->|Yes| K[Resume Operations]
    J -->|No| H

    D --> L[Schedule at Reset Time]
    L --> M[Wait for Reset]
    M --> N[Retry Operation]

    E --> O[Exponential Backoff]
    O --> P[Retry with Delay]
    P --> Q{Max Retries?}
    Q -->|No| O
    Q -->|Yes| R[Mark as Failed]

    F --> S[Log Fatal Error]
    S --> T[Graceful Shutdown]
    T --> U[Cleanup Resources]

    %% Consistent styling
    style A fill:#ffebee
    style B fill:#f3e5f5
    style C fill:#ffebee
    style D fill:#ffe0b2
    style E fill:#fff3e0
    style J fill:#f3e5f5
    style K fill:#e8f5e9
    style L fill:#e8f5e9
    style Q fill:#f3e5f5
    style R fill:#ffebee
    style S fill:#ffebee
```

## 7. Configuration Loading and Validation

```mermaid
graph TD
    A[Start Configuration] --> B[Load Environment Variables]
    B --> C[Apply Default Values]
    C --> D[Parse Numeric Values]
    D --> E[Validate Required Fields]
    E --> F{Validation Passed?}
    F -->|No| G[Throw Configuration Error]
    F -->|Yes| H[Create Config Object]
    H --> I[Log Configuration Summary]
    I --> J[Return Valid Config]
    G --> K[Application Termination]

    %% Consistent styling
    style A fill:#e1f5fe
    style F fill:#f3e5f5
    style G fill:#ffebee
    style H fill:#e8f5e9
    style J fill:#e8f5e9
    style K fill:#ffebee
```

## Master System Architecture

```mermaid
graph TB
    subgraph INIT ["**Initialization Phase**"]
        A["`**Application Start**
        _Entry Point_`"] --> B["`**Load & Validate Config**
        _Environment setup_`"]
        B --> C["`**Create Scheduler**
        _Initialize automation_`"]
    end

    subgraph AUTH ["Authentication Layer"]
        D["`**Check Claude CLI Auth**
        _Verify credentials_`"]
        E["`**Credentials Watcher**
        _Monitor file changes_`"]
        F["`**Auto-retry Logic**
        _Recover from auth failures_`"]

        D --> E
        E --> F
    end

    subgraph SCHEDULE ["**Scheduling Engine**"]
        G["`**Strategy Manager**
        _Select scheduling approach_`"]
        H["`**Timer Management**
        _Handle 5-hour cycles_`"]
        I["`**Session Tracking**
        _Monitor Claude activity_`"]

        G --> H
        H --> I
    end

    subgraph EXEC ["**Execution Layer**"]
        J["`**Keepalive Executor**
        _Send ping messages_`"]
        K["`**Cycle Limit Handler**
        _Parse Claude responses_`"]
        L["`**Failure Recovery**
        _Exponential backoff_`"]

        J --> K
        K --> L
    end

    subgraph UTILS ["**Utility Services**"]
        M["`**Logger**
        _Structured logging_`"]
        N["`**Timezone Handler**
        _UTC normalization_`"]
        O["`**Cycle Detector**
        _Session analysis_`"]
    end

    subgraph EXT ["**External Dependencies**"]
        P["`**Claude CLI**
        _Official client_`"]
        Q["`**JSONL Files**
        _Session data_`"]
        R["`**Environment**
        _Config & credentials_`"]
    end

    %% Flow connections
    INIT --> AUTH
    AUTH --> SCHEDULE
    SCHEDULE --> EXEC
    EXEC --> SCHEDULE

    %% Utility connections
    SCHEDULE -.->|"Uses"| UTILS
    EXEC -.->|"Uses"| UTILS
    AUTH -.->|"Uses"| UTILS

    %% External connections
    AUTH -.->|"Monitors"| EXT
    EXEC -.->|"Calls"| EXT
    SCHEDULE -.->|"Reads"| EXT

    %% Annotations
    NOTE_ARCH["`Architecture Notes
    _• Single-threaded Node.js process
    • Event-driven with timers
    • Fault-tolerant design
    • Docker-first deployment_`"]

    NOTE_PERF["`Performance Characteristics
    _• ~1 API call per 5-hour cycle
    • Minimal memory footprint
    • No external dependencies
    • 24/7 operation capability_`"]

    SCHEDULE -.->|"Design"| NOTE_ARCH
    EXEC -.->|"Performance"| NOTE_PERF
```

## Component Interaction Overview

```mermaid
graph TB
    subgraph "Application Layer"
        A[index.js] --> B[Configuration Manager]
        A --> C[Claude Scheduler]
    end

    subgraph "Core Components"
        C --> D[Claude Client]
        C --> E[Session Tracker]
        D --> F[Cycle Limit Parser]
        E --> G[Cycle Detection]
        E --> H[Timezone Handler]
    end

    subgraph "Utilities"
        I[Logger] --> J[Time Formatter]
        F --> K[Cycle Limit Strategies]
        C --> L[Scheduling Strategies]
    end

    subgraph "External Dependencies"
        D --> M[Claude CLI]
        E --> N[JSONL Session Files]
        B --> O[Environment Variables]
    end

    I -.->|Used by| C
    I -.->|Used by| D
    I -.->|Used by| E
```

## Key Design Principles

1. **Strategy Pattern**: Both cycle limit parsing and scheduling use strategy patterns for flexibility and maintainability
2. **Error Recovery**: Comprehensive error handling with automatic recovery mechanisms
3. **Session Awareness**: Smart scheduling based on actual Claude session state
4. **State Persistence**: lastScheduledTime preserved across authentication failures to prevent schedule drift
5. **Resource Management**: Proper cleanup and graceful shutdown handling
6. **Observability**: Comprehensive logging throughout all workflows
7. **Containerization**: Docker-first approach for consistent deployment
