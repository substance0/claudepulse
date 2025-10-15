# ClaudePulse Application Workflow Diagrams

This document presents the functional workflows of the ClaudePulse application using Mermaid diagrams.

## Table of Contents

1. [Main Application Workflow](#1-main-application-workflow)
2. [Scheduler Workflow](#2-scheduler-workflow)
3. [Scheduling Strategy Selection](#3-scheduling-strategy-selection)
4. [Rate Limit Handling Workflow](#4-rate-limit-handling-workflow)
5. [Session Tracking Workflow](#5-session-tracking-workflow)
6. [Error Handling and Recovery](#6-error-handling-and-recovery)
7. [Configuration Loading and Validation](#7-configuration-loading-and-validation)
8. [Docker Deployment Workflow](#8-docker-deployment-workflow)
9. [Authentication Recovery and State Persistence](#9-authentication-recovery-and-state-persistence)
10. [Master System Architecture](#master-system-architecture)
11. [Component Interaction Overview](#component-interaction-overview)
12. [Key Design Principles](#key-design-principles)

## 1. Main Application Workflow

```mermaid
graph TD
    A["`**Application Start**
    _Initializes ClaudePulse process_`"] --> B["`**Load Configuration**
    _From env vars + defaults_`"]

    B --> C["`**Validate Configuration**
    _Check required fields_`"]

    C --> D["`**Create ClaudeScheduler**
    _Initialize automation engine_`"]

    D --> E["`**Start Scheduler**
    _Test auth + begin operation_`"]

    E --> F{"`**Start Successful?**
    _Authentication check_`"}

    F -->|"✗ Auth Failed"| G["`**Watch Credentials**
    _Monitor ~/.claude/ for changes_`"]

    F -->|"✗ Other Error"| H{"`**Keep Alive on Failure?**
    _KEEP_ALIVE_ON_FAILURE setting_`"}

    F -->|"✗ Network Error"| AA["`**Network Error Handler**
    _Exponential backoff retry_`"]

    F -->|"✗ Process Error"| BB["`**Process Error Handler**
    _Log and attempt recovery_`"]

    F -->|"✓ Success"| I["`**Scheduler Running**
    _Ready for pulse cycle_`"]

    G --> J["`**Wait for Credentials**
    _Check every 2 seconds_`"]

    J --> K{"`**Credentials Updated?**
    _File modification time changed_`"}

    K -->|"✓ Updated"| E
    K -->|"No Change"| J

    H -->|"Debug Mode"| L["`**Hold Process**
    _Keep alive for debugging_`"]

    H -->|"Exit"| M["`**Return Error**
    _Graceful failure_`"]

    AA --> CC{"`**Network Retry Limit?**
    _Max attempts reached_`"}
    CC -->|"Continue"| DD["`**Exponential Backoff**
    _Wait longer before retry_`"]
    CC -->|"Give Up"| M
    DD --> E

    BB --> EE{"`**Process Recoverable?**
    _Error type analysis_`"}
    EE -->|"Recoverable"| E
    EE -->|"Fatal"| M

    I --> N{"`**Dry Run Mode?**
    _DRY_RUN environment variable_`"}

    N -->|"Test Only"| O["`**Exit Early**
    _Analysis complete_`"]

    N -->|"Production"| P["`**Setup Shutdown Handlers**
    _SIGINT, SIGTERM handling_`"]

    P --> Q["`**Setup Error Handlers**
    _Uncaught exceptions_`"]

    Q --> R["`**Application Running**
    _Keepalive automation active_`"]

    R --> S["`**Graceful Shutdown**
    _Clean resource cleanup_`"]

    %% Visual annotations
    NOTE1["`Authentication Recovery
    _Automatic retry on credential updates
    No manual intervention required
    Preserves lastScheduledTime across failures_`"]

    NOTE2["`Performance Note
    _Single scheduler instance handles
    all 5-hour pulse cycles_`"]

    NOTE3["`**Error Resilience**
    _Network errors use exponential backoff
    Process errors attempt smart recovery
    Authentication failures trigger credential watch_`"]

    G -.->|"Recovery process"| NOTE1
    I -.->|"Architecture"| NOTE2
    AA -.->|"Fault tolerance"| NOTE3
    BB -.->|"Recovery strategy"| NOTE3
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

    I --> K{"`**Rate Limited?**
    _5-hour limit reached message_`"}

    K -->|"Yes"| L["`**Parse Rate Limit Info**
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
    Rate limiting is expected behavior_`"]

    NOTE4["`**Reliability Design**
    _Never stops trying to schedule
    Failures don't break the cycle_`"]

    K -.->|"Expected behavior"| NOTE3
    Q -.->|"Fault tolerance"| NOTE4
```

## 3. Scheduling Strategy Selection

```mermaid
graph TD
    A["`**Schedule Request**
    _Determine next pulse time_`"] --> B{"`**External Signal?**
    _Rate limit reset signal_`"}

    B -->|"✓ Yes"| C["`**External Signal Strategy**
    _Highest priority scheduling_`"]
    C --> D["`**Align to Hour + 10m**
    _Schedule at reset time + buffer_`"]
    D --> E["`**Schedule Execution**
    _Timer set for calculated time_`"]

    B -->|"✗ No"| F{"`**Has Last Scheduled Time?**
    _Previous pulse exists_`"}

    F -->|"✓ Yes"| G["`**Fixed Cadence Strategy**
    _Maintain 5-hour intervals_`"]
    G --> H["`**Last Time + 5 Hours**
    _Consistent scheduling pattern_`"]
    H --> E

    F -->|"✗ No"| I{"`**Reset Hour Configured?**
    _RESET_HOUR environment variable_`"}

    I -->|"✓ Yes"| J["`Reset Hour Anchor Strategy
    _Align to business hours_`"]
    J --> K["`**Next Reset Hour + 10m**
    _e.g., 9:10am, 2:10pm, 7:10pm_`"]
    K --> E

    I -->|"✗ No"| L["`**Session Expiry Strategy**
    _Use Claude session data_`"]
    L --> M["`**Update Session Tracking**
    _Scan JSONL files for activity_`"]
    M --> N{"`**Session Expiry Available?**
    _Active 5-hour window found_`"}

    N -->|"✓ Yes"| O["`**Session Expiry + 10m**
    _Schedule after current window_`"]
    N -->|"✗ No"| P["`Initial Align Strategy
    _First-run fallback_`"]
    O --> E
    P --> Q["`**Next Hour + 10m**
    _Safe default scheduling_`"]
    Q --> E

    %% Strategy annotations
    NOTE_EXT["`**External Signal Priority**
    _Overrides all other strategies
    Uses precise reset time from Claude
    Always includes 10-minute buffer_`"]

    NOTE_RESET["`RESET_HOUR Configuration
    _Examples: RESET_HOUR=9,14,19
    Creates 9am, 2pm, 7pm anchors
    Finds next anchor after current time
    Ideal for business hour alignment_`"]

    NOTE_CADENCE["`**Fixed Cadence Behavior**
    _Preserves exact 5-hour intervals
    Most predictable scheduling pattern
    Used once initial schedule established_`"]

    C -.->|"Highest priority"| NOTE_EXT
    J -.->|"Configuration"| NOTE_RESET
    G -.->|"Predictable timing"| NOTE_CADENCE
```

## 4. Rate Limit Handling Workflow

```mermaid
%% This is a comment explaining the flow
graph TD
    A[Claude CLI Call Failed] --> B[Parse Error Message]
    B --> C{Auth Error?}
    C -->|Yes| D[Return No Rate Limit]
    C -->|No| E[Check Claude Rate Limit Format]
    E --> F{"#quot;5-hour limit reached ∙ resets Xpm#quot;?"}
    F -->|Yes| G[Parse Reset Hour]
    F -->|No| H[Return No Rate Limit]
    G --> I[Convert to 24-hour Format]
    I --> J[Calculate Reset Time]
    J --> K[Schedule at Reset Time + Buffer]
    H --> L[Handle as Normal Error]
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
```

## 6. Error Handling and Recovery

```mermaid
graph TD
    A[Error Detected] --> B{Error Type}
    B -->|Authentication| C[Mark Auth Failure]
    B -->|Rate Limit| D[Parse Rate Limit Info]
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
```

## 8. Docker Deployment Workflow

```mermaid
graph TD
    A[Docker Build] --> B[Copy Application Files]
    B --> C[Install Dependencies]
    C --> D[Set Working Directory]
    D --> E[Configure Non-root User]
    E --> F[Set Entry Point]
    F --> G[Build Complete]

    G --> H[Container Start]
    H --> I[Mount Credentials Volume]
    I --> J[Mount Session Data Volume]
    J --> K[Start ClaudePulse Application]
    K --> L[Application Running in Container]
    L --> M[Monitor Container Health]
    M --> N{Container Healthy?}
    N -->|Yes| O[Continue Operation]
    N -->|No| P[Container Restart]
    O --> M
    P --> H
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
        K["`**Rate Limit Handler**
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
        D --> F[Rate Limit Parser]
        E --> G[Cycle Detection]
        E --> H[Timezone Handler]
    end

    subgraph "Utilities"
        I[Logger] --> J[Time Formatter]
        F --> K[Rate Limit Strategies]
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

## 9. Authentication Recovery and State Persistence

```mermaid
graph TD
    A["`**Scheduler Running**
    _Normal operation state_`"] --> B["`**Execute Keepalive**
    _Send ping to Claude CLI_`"]

    B --> C{"`**Authentication Success?**
    _CLI response analysis_`"}

    C -->|"✓ Success"| D["`**Update Last Success Time**
    _Record successful pulse_`"]

    C -->|"✗ Auth Failed"| E["`**Preserve Schedule State**
    _Keep lastScheduledTime intact_`"]

    D --> F["`**Schedule Next Cycle**
    _Use Fixed Cadence Strategy_`"]

    E --> G["`**Start Credentials Watcher**
    _Monitor ~/.claude/ for changes_`"]

    G --> H["`**Wait for Credential Update**
    _Check file modification time_`"]

    H --> I{"`**Credentials Changed?**
    _File timestamp comparison_`"}

    I -->|"✗ No Change"| H
    I -->|"✓ Updated"| J["`**Retry Authentication**
    _Test with new credentials_`"]

    J --> K{"`**Auth Recovery Success?**
    _New credentials valid_`"}

    K -->|"✗ Still Failed"| G
    K -->|"✓ Success"| L["`**Resume with Preserved Schedule**
    _Use existing lastScheduledTime_`"]

    L --> M["`**Calculate Next Run Time**
    _lastScheduledTime + 5 hours_`"]

    M --> N["`**Continue Normal Operation**
    _Seamless recovery complete_`"]

    F --> A
    N --> A

    %% State persistence annotations
    NOTE_PERSIST["`State Persistence Strategy
    _lastScheduledTime preserved during auth failures
    Prevents schedule drift after recovery
    Maintains consistent 5-hour intervals
    No manual intervention required_`"]

    NOTE_RECOVERY["`**Recovery Characteristics**
    _Automatic credential monitoring
    Instantaneous recovery on file change
    Zero schedule disruption
    Graceful failure handling_`"]

    NOTE_TIMING["`**Timing Behavior**
    _Auth failure at T+0: pulse skipped
    Credential update at T+30min: auth recovered
    Next schedule: T+5hours (original plan)
    No catchup attempts or schedule drift_`"]

    E -.->|"State management"| NOTE_PERSIST
    G -.->|"Recovery process"| NOTE_RECOVERY
    M -.->|"Schedule integrity"| NOTE_TIMING
```

## Key Design Principles

1. **Strategy Pattern**: Both rate limit parsing and scheduling use strategy patterns for flexibility and maintainability
2. **Error Recovery**: Comprehensive error handling with automatic recovery mechanisms
3. **Session Awareness**: Smart scheduling based on actual Claude session state
4. **State Persistence**: lastScheduledTime preserved across authentication failures to prevent schedule drift
5. **Resource Management**: Proper cleanup and graceful shutdown handling
6. **Observability**: Comprehensive logging throughout all workflows
7. **Containerization**: Docker-first approach for consistent deployment