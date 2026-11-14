import type { AgentApproval, AgentEvent, AgentTask, DraftAttachment, QueueSnapshot } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  plainTaskTitle,
  TASKS_CLOSED_SHOWN,
  type TasksSectionId,
  taskApproval,
  taskSections,
  taskTone,
} from "@openbot/team-client/agent-tasks";
import {
  ActiveCurrentRow,
  ArrowUp,
  Button,
  buttonVariants,
  Check,
  ChevronDown,
  Combobox,
  LoaderCircle,
  Mic,
  Popover,
  Search,
  X,
} from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { PanelResizer } from "@openbot/ui/components/PanelResizer";
import { QuestionPromptBubble } from "@openbot/ui/components/QuestionPromptBubble";
import { SwapLabel, type SwapMotion } from "@openbot/ui/components/SwapLabel";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { AgentTaskMark, type AgentTaskWait, agentTaskStatus } from "@openbot/ui/features/conversation/AgentTasks";
import { ApprovalCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import {
  ComposerAttachmentRow,
  type ComposerPendingImage,
} from "@openbot/ui/features/conversation/ComposerAttachmentRow";
import {
  ComposerEditor,
  type ComposerPasteResult,
  type ComposerSelection,
} from "@openbot/ui/features/conversation/ComposerEditor";
import { ComposerNotice } from "@openbot/ui/features/conversation/ComposerNotice";
import { ComposerStackCard } from "@openbot/ui/features/conversation/ComposerStackCard";
import type { SendShortcut } from "@openbot/ui/features/conversation/send-shortcut";
import {
  type VoicePhase,
  VoiceRecordingMorph,
  voiceButtonLabel,
} from "@openbot/ui/features/conversation/VoiceRecordingMorph";
import { PageHeader, type PageHeaderFrame } from "@openbot/ui/features/window/PageHeader";
import { ContentExitMotion } from "@openbot/ui/menu-motion";
import { useText } from "@openbot/ui/text";
import { prefersReducedMotion } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import {
  createEffect,
  createMemo,
  createSignal,
  createStore,
  createUniqueId,
  For,
  onCleanup,
  onSettled,
  Show,
  untrack,
} from "solid-js";
import { createComposerRowsResize } from "../conversation/createComposerRowsResize";
import { TasksEmptyBoard, TasksEmptyPitch } from "./TasksEmpty";

/** The microphone of the Tasks composer. The page shows it; the app records and transcribes. */
export interface TasksVoice {
  phase: VoicePhase;
  levels: readonly number[];
  elapsedSeconds: number;
  /** The words the recording heard so far. */
  liveText: string;
  /** The download progress of the voice model, in percent, while the phase is "preparing". */
  modelProgress: number | null;
  onStart: () => void;
  onCancel: () => void;
  onFinish: () => void;
  /** True while another message box on the page records. */
  blocked?: boolean | undefined;
}

/** The task of the last start, in the line under the composer. */
interface TasksTook {
  task: AgentTask;
  /** True while the start waits: Undo cancels it, and the agent can change. */
  pending: boolean;
}

interface TasksPageProps {
  hostName: string;
  onBack?: (() => void) | undefined;
  /** In the app window, the header has no Back button and no server name. */
  frame?: PageHeaderFrame | undefined;
  agents: AgentProfile[];
  /** The tasks of all agents, also a start that waits. */
  tasks: readonly AgentTask[];
  /** Whether the task lists of all agents loaded. Only then does a page with no task show how tasks work. */
  loaded?: boolean | undefined;
  /** The agent of the next task. */
  agentId: string;
  onAgentChange: (agentId: string) => void;
  draft: string;
  onDraftChange: (text: string) => void;
  /** The files of the next task. The text names each one where it was added. */
  files?: readonly DraftAttachment[] | undefined;
  /** The files in the thumbnail row: each image, and each other file that the text no longer names. */
  rowFiles?: readonly DraftAttachment[] | undefined;
  /** The pasted images that still import, with their local previews. */
  pendingImages?: readonly ComposerPendingImage[] | undefined;
  onRemoveFile?: ((attachment: DraftAttachment) => void) | undefined;
  /** Receives pasted files and long text pastes, as `ComposerEditor` says. Without it, a file paste does nothing here. */
  onPasteFiles?:
    | ((files: File[], selection: ComposerSelection, text?: string) => Promise<ComposerPasteResult | undefined>)
    | undefined;
  /** Each change moves the focus to the composer. */
  focusRequest: number;
  /** The text of a start that failed. The draft is back in the composer. */
  startError: string | null;
  onDismissStartError: () => void;
  onStart: () => void;
  voice?: TasksVoice | undefined;
  took: TasksTook | null;
  onTookAgentChange: (agentId: string) => void;
  onUndo: () => void;
  onOpenTook: () => void;
  onDismissTook: () => void;
  /** The task in the side panel. */
  selectedId: string | null;
  onSelect: (taskId: string | null) => void;
  /** The conversation of one task, for the side panel. */
  panel: (taskId: string) => JSX.Element;
  /** The width of the side panel that the user chose, in pixels. A narrow page shows it narrower. */
  sideWidth: number;
  /** Each move of the side panel edge. */
  onSideResize: (width: number) => void;
  /** The width at the end of a move, to keep for the next visit. */
  onSideResizeEnd: (width: number) => void;
  /** What the task's running turn waits for from the person: an approval, or an answer in the chat. */
  waitOf?: ((task: AgentTask) => AgentTaskWait) | undefined;
  /** Waiting approvals across all agents/threads. */
  approvals?: readonly AgentApproval[] | undefined;
  onRespondApproval?: ((approval: AgentApproval, decision: "accept" | "decline") => Promise<boolean>) | undefined;
  /** Pending questions and browser takeover requests across agents/threads. */
  pendingPrompts?: Readonly<
    Record<
      string,
      | Extract<AgentEvent, { type: "prompt" | "browser-takeover-requested" }>
      | undefined
    >
  > | undefined;
  activeTurns?: Readonly<Record<string, string | null>> | undefined;
  turnProgress?: Readonly<
    Record<string, { turnId: string; detail: string; running?: boolean; activity?: string } | undefined>
  > | undefined;
  queues?: Readonly<Record<string, QueueSnapshot>> | undefined;
  onSelectAgentChat?: ((agentId: string) => void) | undefined;
  onAnswerPrompt?: (
    agentId: string,
    threadId: string | undefined,
    requestId: string | number,
    answers: Record<string, string[]>,
  ) => Promise<boolean>;
  onRespondBrowserTakeover?: (
    agentId: string,
    threadId: string | undefined,
    requestId: string | number,
    decision: "complete" | "cancel",
  ) => Promise<boolean>;
  onQuickReplyTask?: ((task: AgentTask, text: string) => void) | undefined;
  onArchiveTask?: ((task: AgentTask) => void) | undefined;
  onReopenTask?: ((task: AgentTask) => void) | undefined;
  onOpenInChat?: ((task: AgentTask) => void) | undefined;
  /** The user's send shortcut for the composer. */
  sendShortcut?: SendShortcut | undefined;
  /** The window draws the macOS window controls over the image viewer's top start corner. */
  macWindowControls?: boolean | undefined;
}

const agentOf = (agents: readonly AgentProfile[], agentId: string) => agents.find((agent) => agent.id === agentId);

/** The trigger motion of the header model switcher: mostly a blur, so the old and new name cross in place. */
const AGENT_SWAP: SwapMotion = {
  distance: 6,
  blur: 6,
  enter: { duration: 320, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
  leave: { duration: 180, easing: "ease" },
};

/** Lower case, no accents, and `_`, `/` and `-` as spaces: "cafe" finds "Café Orders". */
const foldChar = (char: string) =>
  char
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\s_/-]/g, " ");

/**
 * The folded text, and for each of its code units the index of the character in `text` that made
 * it. Folding can change the length, so this map finds the matched part in the original name.
 * A run of spaces and separators becomes one space: "Sales - EU" is "sales eu".
 */
function foldName(text: string) {
  let folded = "";
  const source: number[] = [];
  let index = 0;
  for (const char of text) {
    const raw = foldChar(char);
    const part = raw === " " && folded.endsWith(" ") ? "" : raw;
    folded += part;
    for (let unit = 0; unit < part.length; unit++) source.push(index);
    index += char.length;
  }
  return { folded, source };
}

/** Where `query` is in `name`, and its rank: 0 at the start, 1 at the start of a word, 2 in a word. */
function findMatch(name: string, query: string): { at: number; rank: number } | undefined {
  if (name.startsWith(query)) return { at: 0, rank: 0 };
  const first = name.indexOf(query);
  for (let at = first; at > 0; at = name.indexOf(query, at + 1)) {
    if (name[at - 1] === " ") return { at, rank: 1 };
  }
  return first < 0 ? undefined : { at: first, rank: 2 };
}

/** Names that start with the query, or have a word that does, come before names that only contain it. */
function matchAgents(agents: readonly AgentProfile[], query: string): AgentProfile[] {
  const text = foldName(query.trim()).folded;
  if (!text) return [...agents];
  return agents
    .flatMap((agent) => {
      const match = findMatch(foldName(agent.name).folded, text);
      return match ? [{ agent, rank: match.rank }] : [];
    })
    .sort((a, b) => a.rank - b.rank)
    .map((row) => row.agent);
}

/** The agent name with the matched part in bold, so the eye finds why a row is in the list. */
function MatchedAgentName(props: { name: string; query: string }) {
  const parts = createMemo(() => {
    const text = foldName(props.query.trim()).folded;
    const name = foldName(props.name);
    const match = text ? findMatch(name.folded, text) : undefined;
    if (!match) return { before: props.name, match: "", after: "" };
    const start = name.source[match.at] ?? 0;
    const end = name.source[match.at + text.length] ?? props.name.length;
    return {
      before: props.name.slice(0, start),
      match: props.name.slice(start, end),
      after: props.name.slice(end),
    };
  });
  return (
    <span class="tasks-page-agent-name">
      {parts().before}
      <Show when={parts().match}>
        <b>{parts().match}</b>
      </Show>
      {parts().after}
    </span>
  );
}

/**
 * Kobalte finds a row with an unescaped `[data-key="…"]` selector, to scroll it into view and to
 * name the active row. A key with `"`, `\` or U+0000 matches no row, so the key is encoded.
 */
const agentKey = (id: string) => encodeURIComponent(id);

/**
 * True when the window has space under the trigger for the search field and three rows. The menu
 * opens down, and opens up only when it would show no row there.
 */
function roomBelow(trigger: HTMLElement | undefined): boolean {
  if (!trigger) return true;
  const row = Number.parseFloat(getComputedStyle(trigger).getPropertyValue("--openbot-control-md")) || 32;
  return window.innerHeight - trigger.getBoundingClientRect().bottom >= 5 * row;
}

/**
 * The agent of a task, as a menu with the agent's face and a search field. A server can have many
 * agents: typing filters the rows, the arrows move through them, and Enter takes the active row or
 * the first match. A task has one agent, so the menu marks only the chosen agent.
 */
function TaskAgentSelect(props: {
  agents: AgentProfile[];
  agentId: string;
  /** The task title, when the select changes the agent of a task that is already sent. */
  title?: string;
  onChange: (agentId: string) => void;
}) {
  const { t } = useText();
  const agent = () => agentOf(props.agents, props.agentId);
  let shownId = untrack(() => props.agentId);
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const matches = createMemo(() => matchAgents(props.agents, query()));
  const fades = createScrollFades();
  // Kobalte scrolls the current row into view before the list has its final height. So when the
  // list resizes, the active row comes back into view.
  let resize: ResizeObserver | undefined;
  const keepActiveRow = () => {
    const id = input?.getAttribute("aria-activedescendant");
    if (id) document.getElementById(id)?.scrollIntoView({ block: "nearest" });
  };
  onCleanup(() => {
    fades.stop();
    resize?.disconnect();
  });
  const [placement, setPlacement] = createSignal<"bottom-start" | "top-start">("bottom-start");
  let trigger: HTMLElement | undefined;
  let input: HTMLInputElement | undefined;
  let panel: HTMLElement | undefined;
  let list: HTMLElement | undefined;
  const choose = (option: AgentProfile) => {
    setOpen(false);
    if (option.id !== props.agentId) props.onChange(option.id);
  };
  const toggle = (next: boolean) => {
    if (next) {
      setQuery("");
      setPlacement(roomBelow(trigger) ? "bottom-start" : "top-start");
    }
    setOpen(next);
  };
  return (
    <Popover.Root
      open={open()}
      onOpenChange={toggle}
      placement={placement()}
      gutter={4}
      // The list shrinks to the space next to the trigger, so it does not flip when a search adds rows.
      flip={false}
      modal
    >
      <Popover.Trigger
        ref={(element: HTMLElement) => {
          trigger = element;
        }}
        class={`${buttonVariants({ variant: "ghost", size: "sm" })} tasks-page-agent`}
        aria-label={
          props.title === undefined
            ? t("conversation.tasks.page.agent", { name: agent()?.name ?? props.agentId })
            : t("conversation.tasks.page.reassign", { title: props.title, name: agent()?.name ?? props.agentId })
        }
        onKeyDown={(event: KeyboardEvent) => {
          // The arrow keys open the menu, as on a select.
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          toggle(true);
        }}
      >
        {/* Keyed by agent, so the face of a newly chosen agent springs in, as the model mark does. */}
        <For each={[props.agentId]} keyed={(id) => id}>
          {(id) => {
            const entering = untrack(id) !== shownId;
            shownId = untrack(id);
            return (
              <span class="tasks-page-agent-face" data-entering={entering ? "" : undefined}>
                <AgentAvatar agent={agentOf(props.agents, id())} class="tasks-page-avatar" />
              </span>
            );
          }}
        </For>
        <SwapLabel text={agent()?.name ?? props.agentId} motion={AGENT_SWAP} />
        <ChevronDown class="tasks-page-agent-chevron" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={(element: HTMLElement) => {
            panel = element;
          }}
          class="ui-action-menu tasks-page-agent-menu"
          aria-label={t("conversation.tasks.page.agents")}
        >
          <ContentExitMotion panel={() => panel} />
          <Combobox.Root<AgentProfile>
            class="tasks-page-agent-picker"
            options={matches()}
            optionValue={(option) => agentKey(option.id)}
            optionTextValue="name"
            optionLabel="name"
            open={true}
            modal={false}
            triggerMode="manual"
            allowsEmptyCollection={true}
            shouldFocusWrap={true}
            defaultFilter={() => true}
            onInputChange={(value) => {
              setQuery(value);
              // A new search starts at the best match.
              if (list) list.scrollTop = 0;
            }}
            onOpenChange={(next) => {
              if (!next) setOpen(false);
            }}
            onChange={(option) => {
              if (option) choose(option);
            }}
            itemComponent={(item) => (
              <Combobox.Item
                item={item.item}
                class="tasks-page-agent-option"
                // The combobox has no selection, so the row says that it is the current agent.
                aria-selected={item.item.rawValue.id === props.agentId ? "true" : "false"}
              >
                <AgentAvatar agent={item.item.rawValue} class="tasks-page-avatar" />
                <MatchedAgentName name={item.item.rawValue.name} query={query()} />
                <Show when={item.item.rawValue.id === props.agentId}>
                  <Check aria-hidden="true" class="tasks-page-agent-check" />
                </Show>
              </Combobox.Item>
            )}
          >
            <Combobox.Control class="tasks-page-agent-search">
              <Search aria-hidden="true" />
              <Combobox.Input
                ref={(element: HTMLInputElement) => {
                  input = element;
                }}
                class="tasks-page-agent-search-input"
                aria-label={t("conversation.tasks.page.searchAgents")}
                placeholder={t("conversation.tasks.page.searchAgents")}
                autocomplete="off"
                spellcheck={false}
                onKeyDown={(event: KeyboardEvent) => {
                  // After typing, no row is active: then Enter takes the first match.
                  if (event.key !== "Enter" || event.isComposing || !query().trim()) return;
                  if (input?.getAttribute("aria-activedescendant")) return;
                  const [first] = matches();
                  if (!first) return;
                  event.preventDefault();
                  choose(first);
                }}
              />
            </Combobox.Control>
            <ActiveCurrentRow key={agentKey(props.agentId)} />
            <Combobox.Listbox
              ref={(element: HTMLElement) => {
                list = element;
                fades.bind(element);
                resize?.disconnect();
                resize = new ResizeObserver(keepActiveRow);
                resize.observe(element);
              }}
              class={["tasks-page-agent-list", fades.classes()]}
              style={{ "--tasks-agent-rows": String(matches().length) }}
              onScroll={fades.measure}
              aria-label={t("conversation.tasks.page.agents")}
            />
            <Show when={matches().length === 0}>
              <p class="tasks-page-agent-empty" role="status">
                {t("conversation.tasks.page.noAgent", { query: query().trim() })}
              </p>
            </Show>
          </Combobox.Root>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The composer of the Tasks page: the conversation composer, and the agent selector in its toolbar.
 * Enter starts the task and Shift+Enter adds a line. The microphone dictates the task, as in a chat.
 */
function TasksComposer(props: TasksPageProps) {
  const { t } = useText();
  const phase = (): VoicePhase => props.voice?.phase ?? "idle";
  const busy = () => phase() === "requesting" || phase() === "preparing" || phase() === "transcribing";
  const draftRows = createComposerRowsResize();
  const hasRow = () => (props.rowFiles?.length ?? 0) > 0 || (props.pendingImages?.length ?? 0) > 0;
  // A start of files only names them, so it has a title too.
  const canStart = () =>
    phase() === "recording" ||
    (phase() === "idle" && (plainTaskTitle(props.draft) !== "" || (props.files?.length ?? 0) > 0));
  const start = () => {
    if (canStart()) props.onStart();
  };
  const send = () => (
    <Button
      type="submit"
      variant="ghost"
      class="voice-button"
      aria-label={phase() === "recording" ? t("composer.send.voice") : t("conversation.tasks.page.start")}
      disabled={!canStart()}
    >
      <ArrowUp aria-hidden="true" />
    </Button>
  );
  return (
    <div class="composer-wrap tasks-page-composer">
      <div class="composer-stack">
        <ComposerStackCard when={props.startError}>
          {(body) => (
            <ComposerNotice
              tone="danger"
              title={t("conversation.tasks.error.start")}
              body={body()}
              onDismiss={props.onDismissStartError}
            />
          )}
        </ComposerStackCard>
      </div>
      <form
        ref={draftRows.form}
        class="composer"
        // One row, as the chat input. With files, the file row is above the text and the agent is under it.
        data-compact={hasRow() ? undefined : ""}
        data-has-attachments={hasRow() ? "" : undefined}
        onSubmit={(event) => {
          event.preventDefault();
          start();
        }}
      >
        <ComposerAttachmentRow
          attachments={props.rowFiles ?? []}
          pending={props.pendingImages}
          removeDisabled={phase() === "transcribing"}
          onRemove={(attachment) => props.onRemoveFile?.(attachment)}
          macWindowControls={props.macWindowControls}
        />
        <div class="composer-input-label" ref={draftRows.label}>
          <ComposerEditor
            agentId={undefined}
            agents={props.agents}
            value={props.draft}
            placeholder={t("conversation.tasks.page.ask")}
            ariaLabel={t("conversation.tasks.page.ask")}
            disabled={phase() === "transcribing"}
            focusRequest={props.focusRequest}
            dictation={{ text: props.voice?.liveText ?? "", final: phase() === "transcribing" }}
            sendShortcut={props.sendShortcut}
            onSubmit={start}
            onValueChange={props.onDraftChange}
            attachments={props.files ? [...props.files] : undefined}
            onPasteFiles={props.onPasteFiles}
          />
        </div>
        <div class="composer-toolbar">
          <div class="tasks-page-composer-agent">
            <TaskAgentSelect agents={props.agents} agentId={props.agentId} onChange={props.onAgentChange} />
          </div>
          <div class="composer-primary-actions">
            <Show when={props.voice} fallback={send()}>
              {(voice) => (
                <>
                  <Show when={phase() === "preparing"}>
                    <span class="voice-model-progress" role="status">
                      {t("composer.voice.progress", { progress: voice().modelProgress ?? 0 })}
                    </span>
                  </Show>
                  <VoiceRecordingMorph
                    recording={phase() === "recording"}
                    levels={[...voice().levels]}
                    elapsedSeconds={voice().elapsedSeconds}
                    onCancel={() => voice().onCancel()}
                    onFinish={() => voice().onFinish()}
                    send={send()}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      class="dictation-button"
                      aria-label={t(voiceButtonLabel(phase()))}
                      disabled={busy() || voice().blocked === true}
                      onClick={() => voice().onStart()}
                    >
                      <Show when={busy()} fallback={<Mic aria-hidden="true" />}>
                        <LoaderCircle class="composer-spinner" aria-hidden="true" />
                      </Show>
                    </Button>
                  </VoiceRecordingMorph>
                </>
              )}
            </Show>
          </div>
        </div>
      </form>
    </div>
  );
}

/** The line under the composer after a start: the agent that took the task, Undo, and Open. */
function TaskTookLine(props: TasksPageProps & { took: TasksTook }) {
  const { t } = useText();
  const agent = () => agentOf(props.agents, props.took.task.agentId);
  return (
    <div class="tasks-page-took">
      <Show
        when={props.took.pending}
        fallback={
          <span class="tasks-page-took-agent">
            <AgentAvatar agent={agent()} class="tasks-page-avatar" />
            <span>{agent()?.name ?? props.took.task.agentId}</span>
          </span>
        }
      >
        <TaskAgentSelect
          agents={props.agents}
          agentId={props.took.task.agentId}
          title={props.took.task.title}
          onChange={props.onTookAgentChange}
        />
      </Show>
      <span class="tasks-page-took-text">{t("conversation.tasks.page.took", { title: props.took.task.title })}</span>
      <Show when={props.took.pending}>
        <Button type="button" variant="ghost" size="sm" onClick={() => props.onUndo()}>
          {t("conversation.tasks.page.undo")}
        </Button>
      </Show>
      <Button type="button" variant="ghost" size="sm" onClick={() => props.onOpenTook()}>
        {t("common.open")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("conversation.tasks.page.dismiss")}
        onClick={() => props.onDismissTook()}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}

/** One task in the list: its mark, title and state, and the face of its agent at the end. */
function TaskRow(props: {
  task: AgentTask;
  agent: AgentProfile | undefined;
  selected: boolean;
  wait: AgentTaskWait;
  onOpen: () => void;
}) {
  const { t } = useText();
  const status = () => agentTaskStatus(props.task, t, props.wait);
  return (
    <Button
      type="button"
      variant="ghost"
      class="tasks-page-row"
      data-selected={props.selected ? "" : undefined}
      aria-label={t("conversation.tasks.page.row", {
        title: props.task.title,
        agent: props.agent?.name ?? props.task.agentId,
        status: status(),
      })}
      aria-pressed={props.selected ? "true" : "false"}
      onClick={() => props.onOpen()}
    >
      <AgentTaskMark task={props.task} decorative />
      <span class="tasks-page-row-title" title={props.task.title}>
        {props.task.title}
      </span>
      <span class="tasks-page-status" data-tone={props.wait ? "attention" : taskTone(props.task)}>
        {status()}
      </span>
      <AgentAvatar agent={props.agent} class="tasks-page-avatar" />
    </Button>
  );
}

export type TasksHubViewMode = "kanban" | "gantt" | "list";
export type GanttRangeKey = "6h" | "24h" | "7d" | "30d";

const VIEW_MODE_STORAGE_KEY = "openbot:tasks-view-mode:v1";

function readSavedViewMode(): TasksHubViewMode {
  try {
    const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (saved === "kanban" || saved === "gantt" || saved === "list") return saved;
  } catch {
    // ignore storage errors
  }
  return "kanban";
}

function saveViewMode(mode: TasksHubViewMode): void {
  try {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore storage errors
  }
}

function formatRelativeTimePt(isoOrMs: string | number | null | undefined): string {
  if (!isoOrMs) return "";
  const time = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(time)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (diffSec < 60) return "agora";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `há ${diffMin}min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `há ${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `há ${diffDays}d`;
}

function formatDurationPt(startMs: number, endMs: number): string {
  const sec = Math.max(1, Math.floor((endMs - startMs) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ${min % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

interface UnifiedAttentionEntry {
  key: string;
  agentId: string;
  threadId?: string | undefined;
  task?: AgentTask | undefined;
  kind: "approval" | "question" | "browser-takeover" | "task-wait";
  approval?: AgentApproval | undefined;
  promptEvent?: Extract<AgentEvent, { type: "prompt" }> | undefined;
  takeoverEvent?: Extract<AgentEvent, { type: "browser-takeover-requested" }> | undefined;
}

function collectAttentionEntries(
  props: TasksPageProps,
  filterAgentId: string,
  searchQuery: string,
): UnifiedAttentionEntry[] {
  const entries: UnifiedAttentionEntry[] = [];
  const seenKeys = new Set<string>();
  const query = searchQuery.trim().toLowerCase();

  const matchesFilter = (agentId: string, text: string) => {
    if (filterAgentId && agentId !== filterAgentId) return false;
    if (!query) return true;
    const agentName = agentOf(props.agents, agentId)?.name?.toLowerCase() ?? "";
    return text.toLowerCase().includes(query) || agentName.includes(query);
  };

  for (const approval of props.approvals ?? []) {
    const task = props.tasks.find(
      (candidate) => candidate.agentId === approval.agentId && candidate.threadId === approval.threadId,
    );
    const key = `approval:${approval.agentId}:${String(approval.requestId)}`;
    if (!matchesFilter(approval.agentId, `${approval.command ?? ""} ${task?.title ?? ""}`)) continue;
    seenKeys.add(key);
    if (task) seenKeys.add(`task:${task.id}`);
    entries.push({
      key,
      agentId: approval.agentId,
      threadId: approval.threadId ?? undefined,
      task,
      kind: "approval",
      approval,
    });
  }

  for (const [attKey, event] of Object.entries(props.pendingPrompts ?? {})) {
    if (!event) continue;
    const [agentIdFromKey, threadIdFromKey] = attKey.split("\0");
    if (event.type === "prompt") {
      const agentId = event.agentId || agentIdFromKey || "";
      const threadId = event.threadId ?? threadIdFromKey ?? undefined;
      const task = props.tasks.find(
        (candidate) => candidate.agentId === agentId && threadId && candidate.threadId === threadId,
      );
      const qText = event.questions.map((q) => q.question).join(" ");
      if (!matchesFilter(agentId, `${qText} ${task?.title ?? ""}`)) continue;
      const key = `prompt:${agentId}:${String(event.requestId)}`;
      seenKeys.add(key);
      if (task) seenKeys.add(`task:${task.id}`);
      entries.push({
        key,
        agentId,
        threadId,
        task,
        kind: "question",
        promptEvent: event,
      });
    } else if (event.type === "browser-takeover-requested") {
      const agentId = event.request.agentId || agentIdFromKey || "";
      const threadId = event.request.threadId ?? threadIdFromKey ?? undefined;
      const task = props.tasks.find(
        (candidate) => candidate.agentId === agentId && threadId && candidate.threadId === threadId,
      );
      const takeoverDesc = event.request.reason ?? "Assumir controle do navegador";
      if (!matchesFilter(agentId, `${takeoverDesc} ${task?.title ?? ""}`)) continue;
      const key = `takeover:${agentId}:${String(event.request.requestId)}`;
      seenKeys.add(key);
      if (task) seenKeys.add(`task:${task.id}`);
      entries.push({
        key,
        agentId,
        threadId,
        task,
        kind: "browser-takeover",
        takeoverEvent: event,
      });
    }
  }

  for (const task of props.tasks) {
    const wait = props.waitOf?.(task);
    if (!wait || seenKeys.has(`task:${task.id}`)) continue;
    if (!matchesFilter(task.agentId, `${task.title} ${task.progress ?? task.error ?? ""}`)) continue;
    entries.push({
      key: `task:${task.id}`,
      agentId: task.agentId,
      threadId: task.threadId,
      task,
      kind: "task-wait",
      approval: props.approvals ? taskApproval(task, props.approvals) : undefined,
    });
  }

  return entries;
}

function AttentionActionCard(props: {
  entry: UnifiedAttentionEntry;
  pageProps: TasksPageProps;
}) {
  const agent = () => agentOf(props.pageProps.agents, props.entry.agentId);
  const [busy, setBusy] = createSignal(false);
  return (
    <div class="tasks-hub-card tasks-hub-card-attention">
      <div class="tasks-hub-card-top">
        <span class="tasks-hub-agent-pill">
          <AgentAvatar agent={agent()} class="tasks-page-avatar" />
          <strong>{agent()?.name ?? props.entry.agentId}</strong>
        </span>
        <span class="tasks-hub-badge" data-tone="attention">
          {props.entry.kind === "approval"
            ? "🚨 Pede Permissão"
            : props.entry.kind === "question"
              ? "❓ Pergunta p/ Você"
              : props.entry.kind === "browser-takeover"
                ? "🌐 Assumir Navegador"
                : "⏳ Depende de Você"}
        </span>
      </div>

      <Show when={props.entry.task}>
        {(task) => (
          <button
            type="button"
            class="tasks-hub-card-title-btn"
            onClick={() => props.pageProps.onSelect(task().id)}
          >
            {task().title}
          </button>
        )}
      </Show>

      <Show when={props.entry.approval}>
        {(approval) => (
          <div class="tasks-hub-inline-prompt">
            <ApprovalCard
              approval={approval()}
              onApprove={async () => {
                if (!props.pageProps.onRespondApproval) return false;
                setBusy(true);
                try {
                  return await props.pageProps.onRespondApproval(approval(), "accept");
                } finally {
                  setBusy(false);
                }
              }}
              onReject={async () => {
                if (!props.pageProps.onRespondApproval) return false;
                setBusy(true);
                try {
                  return await props.pageProps.onRespondApproval(approval(), "decline");
                } finally {
                  setBusy(false);
                }
              }}
            />
          </div>
        )}
      </Show>

      <Show when={props.entry.promptEvent}>
        {(promptEvent) => (
          <div class="tasks-hub-inline-prompt">
            <QuestionPromptBubble
              questions={promptEvent().questions}
              sendShortcut={props.pageProps.sendShortcut}
              onOpenLink={(url) => window.open(url, "_blank")}
              onSubmit={async (answers) => {
                if (!props.pageProps.onAnswerPrompt) return false;
                setBusy(true);
                try {
                  return await props.pageProps.onAnswerPrompt(
                    props.entry.agentId,
                    props.entry.threadId,
                    promptEvent().requestId,
                    answers,
                  );
                } finally {
                  setBusy(false);
                }
              }}
            />
          </div>
        )}
      </Show>

      <Show when={props.entry.takeoverEvent}>
        {(takeover) => (
          <div class="tasks-hub-takeover-box">
            <p class="tasks-hub-card-preview">
              {takeover().request.reason === "sign-in-blocked"
                ? "O site bloqueou o login automático. Assuma o navegador para concluir o acesso."
                : "O bot pausou e está aguardando sua ação (login, QR Code ou confirmação) no navegador."}
            </p>
            <div class="tasks-hub-card-actions">
              <Button
                type="button"
                variant="default"
                size="xs"
                loading={busy()}
                onClick={() => {
                  if (!props.pageProps.onRespondBrowserTakeover) return;
                  setBusy(true);
                  void props.pageProps
                    .onRespondBrowserTakeover(
                      props.entry.agentId,
                      props.entry.threadId,
                      takeover().request.requestId,
                      "complete",
                    )
                    .finally(() => setBusy(false));
                }}
              >
                ✅ Já resolvi, pode seguir
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={() => {
                  if (props.entry.task && props.pageProps.onOpenInChat) {
                    props.pageProps.onOpenInChat(props.entry.task);
                  } else {
                    props.pageProps.onSelectAgentChat?.(props.entry.agentId);
                  }
                }}
              >
                🖐 Abrir Navegador / Chat
              </Button>
            </div>
          </div>
        )}
      </Show>

      <Show
        when={
          !props.entry.approval &&
          !props.entry.promptEvent &&
          !props.entry.takeoverEvent &&
          props.entry.task
        }
      >
        {(task) => (
          <div class="tasks-hub-takeover-box">
            <Show when={task().progress ?? task().error}>
              {(preview) => <p class="tasks-hub-card-preview">{preview()}</p>}
            </Show>
            <div class="tasks-hub-card-actions">
              <Button
                type="button"
                variant="default"
                size="xs"
                onClick={() => props.pageProps.onSelect(task().id)}
              >
                💬 Ver & Responder
              </Button>
              <Show when={props.pageProps.onOpenInChat}>
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  onClick={() => props.pageProps.onOpenInChat?.(task())}
                >
                  Abrir no Chat
                </Button>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

function KanbanTaskCard(props: {
  task: AgentTask;
  pageProps: TasksPageProps;
  column: "queued" | "running" | "delivered";
}) {
  const { t } = useText();
  const agent = () => agentOf(props.pageProps.agents, props.task.agentId);
  const wait = () => props.pageProps.waitOf?.(props.task);
  const status = () => agentTaskStatus(props.task, t, wait());
  const progress = () => props.pageProps.turnProgress?.[props.task.agentId];
  const [replyOpen, setReplyOpen] = createSignal(false);
  const [replyText, setReplyText] = createSignal("");

  const submitQuickReply = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    props.pageProps.onQuickReplyTask?.(props.task, trimmed);
    setReplyText("");
    setReplyOpen(false);
  };

  return (
    <div
      class="tasks-hub-card"
      data-selected={props.pageProps.selectedId === props.task.id ? "" : undefined}
      data-closed={props.task.state === "closed" ? "" : undefined}
    >
      <div class="tasks-hub-card-top">
        <span class="tasks-hub-agent-pill">
          <AgentAvatar agent={agent()} class="tasks-page-avatar" />
          <strong>{agent()?.name ?? props.task.agentId}</strong>
        </span>
        <span class="tasks-hub-time">{formatRelativeTimePt(props.task.updatedAt || props.task.createdAt)}</span>
      </div>

      <button
        type="button"
        class="tasks-hub-card-title-btn"
        onClick={() =>
          props.pageProps.onSelect(props.pageProps.selectedId === props.task.id ? null : props.task.id)
        }
      >
        <AgentTaskMark task={props.task} decorative />
        <span>{props.task.title}</span>
      </button>

      <Show when={props.column === "running" && (props.task.progress || progress()?.detail)}>
        {(detail) => (
          <div class="tasks-hub-live-step">
            <LoaderCircle class="tasks-hub-spin" aria-hidden="true" />
            <span>{detail()}</span>
          </div>
        )}
      </Show>

      <Show when={props.task.error ?? props.task.queuedMessages[0]?.text}>
        {(preview) => <p class="tasks-hub-card-preview">{preview()}</p>}
      </Show>

      <div class="tasks-hub-card-footer">
        <span class="tasks-page-status" data-tone={wait() ? "attention" : taskTone(props.task)}>
          {status()}
        </span>
        <div class="tasks-hub-card-actions">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() =>
              props.pageProps.onSelect(props.pageProps.selectedId === props.task.id ? null : props.task.id)
            }
          >
            {props.pageProps.selectedId === props.task.id ? "Fechar painel" : "Ver entrega"}
          </Button>
          <Show when={props.column === "delivered" && props.task.state !== "closed"}>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              title="Aprovar a entrega do bot e arquivar a tarefa como concluída"
              onClick={() => props.pageProps.onArchiveTask?.(props.task)}
            >
              ✅ Aprovar
            </Button>
          </Show>
          <Show when={props.task.state !== "closed" && props.pageProps.onQuickReplyTask}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setReplyOpen((open) => !open)}
            >
              ✏️ Ajustar
            </Button>
          </Show>
          <Show when={props.task.state === "closed" && props.pageProps.onReopenTask}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => props.pageProps.onReopenTask?.(props.task)}
            >
              🔄 Reabrir
            </Button>
          </Show>
        </div>
      </div>

      <Show when={replyOpen()}>
        <form
          class="tasks-hub-quick-reply"
          onSubmit={(event) => {
            event.preventDefault();
            submitQuickReply(replyText());
          }}
        >
          <input
            type="text"
            class="tasks-hub-quick-reply-input"
            placeholder={`Passar instrução para ${agent()?.name ?? "o bot"}...`}
            value={replyText()}
            onInput={(event) => setReplyText(event.currentTarget.value)}
          />
          <Button type="submit" variant="default" size="xs">
            Enviar
          </Button>
        </form>
      </Show>
    </div>
  );
}

function TasksKanbanBoard(props: {
  pageProps: TasksPageProps;
  filteredTasks: readonly AgentTask[];
  attentionEntries: readonly UnifiedAttentionEntry[];
  filterAgentId: string;
}) {
  const waitOf = (task: AgentTask) => props.pageProps.waitOf?.(task);

  const queuedTasks = createMemo(() =>
    props.filteredTasks.filter((task) => task.state === "queued" && !waitOf(task)),
  );
  const runningTasks = createMemo(() =>
    props.filteredTasks.filter((task) => task.state === "running" && !waitOf(task)),
  );
  const deliveredTasks = createMemo(() =>
    props.filteredTasks.filter((task) => (task.state === "idle" || task.state === "closed") && !waitOf(task)),
  );

  // Agents actively working in their main chat (outside a task thread) so nothing is hidden!
  const activeMainChatAgents = createMemo(() =>
    props.pageProps.agents.filter((agent) => {
      if (props.filterAgentId && agent.id !== props.filterAgentId) return false;
      const turnId = props.pageProps.activeTurns?.[agent.id];
      if (!turnId) return false;
      const hasRunningTask = runningTasks().some((task) => task.agentId === agent.id);
      return !hasRunningTask;
    }),
  );

  // Agents with queued messages in their main chat
  const queuedMainChatAgents = createMemo(() =>
    props.pageProps.agents.filter((agent) => {
      if (props.filterAgentId && agent.id !== props.filterAgentId) return false;
      const deliveries = props.pageProps.queues?.[agent.id]?.deliveries ?? [];
      return deliveries.length > 0;
    }),
  );

  return (
    <div class="tasks-kanban-grid">
      {/* Column 1: Depende de Mim / Aprovação */}
      <section class="tasks-kanban-col" data-col="attention">
        <header class="tasks-kanban-col-header">
          <span class="tasks-kanban-col-dot" data-tone="attention" />
          <h3>Depende de Mim</h3>
          <span class="tasks-page-count">{props.attentionEntries.length}</span>
        </header>
        <div class="tasks-kanban-col-body">
          <Show
            when={props.attentionEntries.length > 0}
            fallback={
              <div class="tasks-kanban-empty">
                🎉 Nenhum bot travado esperando aprovação ou resposta sua agora.
              </div>
            }
          >
            <For each={props.attentionEntries}>
              {(entry) => <AttentionActionCard entry={entry} pageProps={props.pageProps} />}
            </For>
          </Show>
        </div>
      </section>

      {/* Column 2: Na Fila / Aguardando */}
      <section class="tasks-kanban-col" data-col="queued">
        <header class="tasks-kanban-col-header">
          <span class="tasks-kanban-col-dot" data-tone="queued" />
          <h3>Na Fila</h3>
          <span class="tasks-page-count">{queuedTasks().length + queuedMainChatAgents().length}</span>
        </header>
        <div class="tasks-kanban-col-body">
          <Show
            when={queuedTasks().length > 0 || queuedMainChatAgents().length > 0}
            fallback={<div class="tasks-kanban-empty">Nenhuma tarefa aguardando na fila.</div>}
          >
            <For each={queuedMainChatAgents()}>
              {(agent) => {
                const deliveries = () => props.pageProps.queues?.[agent.id]?.deliveries ?? [];
                return (
                  <div class="tasks-hub-card">
                    <div class="tasks-hub-card-top">
                      <span class="tasks-hub-agent-pill">
                        <AgentAvatar agent={agent} class="tasks-page-avatar" />
                        <strong>{agent.name}</strong>
                      </span>
                      <span class="tasks-hub-badge" data-tone="queued">
                        {deliveries().length} na fila do chat
                      </span>
                    </div>
                    <p class="tasks-hub-card-preview">{deliveries()[0]?.text ?? "Mensagem aguardando turno"}</p>
                    <div class="tasks-hub-card-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => props.pageProps.onSelectAgentChat?.(agent.id)}
                      >
                        Abrir Chat
                      </Button>
                    </div>
                  </div>
                );
              }}
            </For>
            <For each={queuedTasks()}>
              {(task) => <KanbanTaskCard task={task} pageProps={props.pageProps} column="queued" />}
            </For>
          </Show>
        </div>
      </section>

      {/* Column 3: Fazendo Agora (Em Execução) */}
      <section class="tasks-kanban-col" data-col="running">
        <header class="tasks-kanban-col-header">
          <span class="tasks-kanban-col-dot" data-tone="working" />
          <h3>Fazendo Agora</h3>
          <span class="tasks-page-count">{runningTasks().length + activeMainChatAgents().length}</span>
        </header>
        <div class="tasks-kanban-col-body">
          <Show
            when={runningTasks().length > 0 || activeMainChatAgents().length > 0}
            fallback={<div class="tasks-kanban-empty">Nenhum bot executando tarefa neste instante.</div>}
          >
            <For each={activeMainChatAgents()}>
              {(agent) => {
                const prog = () => props.pageProps.turnProgress?.[agent.id];
                return (
                  <div class="tasks-hub-card tasks-hub-card-running">
                    <div class="tasks-hub-card-top">
                      <span class="tasks-hub-agent-pill">
                        <AgentAvatar agent={agent} class="tasks-page-avatar" />
                        <strong>{agent.name}</strong>
                      </span>
                      <span class="tasks-hub-badge" data-tone="working">
                        ⚡ Ativo no Chat
                      </span>
                    </div>
                    <div class="tasks-hub-live-step">
                      <LoaderCircle class="tasks-hub-spin" aria-hidden="true" />
                      <span>{prog()?.detail || prog()?.activity || "Executando turno no chat principal..."}</span>
                    </div>
                    <div class="tasks-hub-card-actions">
                      <Button
                        type="button"
                        variant="secondary"
                        size="xs"
                        onClick={() => props.pageProps.onSelectAgentChat?.(agent.id)}
                      >
                        Acompanhar no Chat
                      </Button>
                    </div>
                  </div>
                );
              }}
            </For>
            <For each={runningTasks()}>
              {(task) => <KanbanTaskCard task={task} pageProps={props.pageProps} column="running" />}
            </For>
          </Show>
        </div>
      </section>

      {/* Column 4: Entregue / Concluído */}
      <section class="tasks-kanban-col" data-col="delivered">
        <header class="tasks-kanban-col-header">
          <span class="tasks-kanban-col-dot" data-tone="delivered" />
          <h3>Entregues & Concluídos</h3>
          <span class="tasks-page-count">{deliveredTasks().length}</span>
        </header>
        <div class="tasks-kanban-col-body">
          <Show
            when={deliveredTasks().length > 0}
            fallback={<div class="tasks-kanban-empty">Nenhuma entrega concluída ainda.</div>}
          >
            <For each={deliveredTasks()}>
              {(task) => <KanbanTaskCard task={task} pageProps={props.pageProps} column="delivered" />}
            </For>
          </Show>
        </div>
      </section>
    </div>
  );
}

const GANTT_RANGE_MS: Record<GanttRangeKey, number> = {
  "6h": 6 * 3600 * 1000,
  "24h": 24 * 3600 * 1000,
  "7d": 7 * 24 * 3600 * 1000,
  "30d": 30 * 24 * 3600 * 1000,
};

function TasksGanttTimeline(props: {
  pageProps: TasksPageProps;
  filteredTasks: readonly AgentTask[];
  attentionEntries: readonly UnifiedAttentionEntry[];
  filterAgentId: string;
}) {
  const [range, setRange] = createSignal<GanttRangeKey>("24h");
  const nowMs = () => Date.now();
  const spanMs = () => GANTT_RANGE_MS[range()];
  const startWindowMs = () => nowMs() - spanMs();

  const ticks = createMemo(() => {
    const start = startWindowMs();
    const span = spanMs();
    const count = 6;
    const list: { pct: number; label: string }[] = [];
    for (let i = 0; i <= count; i++) {
      const tMs = start + (span * i) / count;
      const date = new Date(tMs);
      const label =
        range() === "6h" || range() === "24h"
          ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
          : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      list.push({ pct: (i / count) * 100, label });
    }
    return list;
  });

  const rowsByAgent = createMemo(() => {
    const windowStart = startWindowMs();
    const currentNow = nowMs();
    const agents = props.filterAgentId
      ? props.pageProps.agents.filter((a) => a.id === props.filterAgentId)
      : props.pageProps.agents;

    return agents
      .map((agent) => {
        const agentTasks = props.filteredTasks.filter((task) => {
          if (task.agentId !== agent.id) return false;
          const end =
            task.state === "running" || task.state === "queued"
              ? currentNow
              : Date.parse(task.closedAt || task.updatedAt || task.createdAt);
          return !Number.isFinite(end) || end >= windowStart;
        });
        const isWorkingMain = Boolean(props.pageProps.activeTurns?.[agent.id]);
        const hasAttention = props.attentionEntries.some((entry) => entry.agentId === agent.id);
        return {
          agent,
          tasks: agentTasks,
          isWorkingMain,
          hasAttention,
        };
      })
      .filter((group) => group.tasks.length > 0 || group.isWorkingMain || group.hasAttention);
  });

  const barGeometry = (task: AgentTask) => {
    const windowStart = startWindowMs();
    const currentNow = nowMs();
    const span = spanMs();
    const rawStart = Date.parse(task.createdAt);
    const start = Number.isFinite(rawStart) ? rawStart : currentNow - 15 * 60 * 1000;
    const rawEnd =
      task.state === "running" || task.state === "queued"
        ? currentNow
        : Date.parse(task.closedAt || task.updatedAt || task.createdAt);
    const end = Number.isFinite(rawEnd) ? Math.max(start + 60_000, rawEnd) : currentNow;

    const clampedStart = Math.max(windowStart, Math.min(currentNow, start));
    const clampedEnd = Math.max(clampedStart, Math.min(currentNow, end));
    const leftPct = ((clampedStart - windowStart) / span) * 100;
    const widthPct = Math.max(2.5, ((clampedEnd - clampedStart) / span) * 100);
    return {
      left: `${Math.min(97.5, Math.max(0, leftPct))}%`,
      width: `${Math.min(100 - leftPct, widthPct)}%`,
      durationLabel: formatDurationPt(start, end),
    };
  };

  return (
    <div class="tasks-gantt-wrap">
      <div class="tasks-gantt-toolbar">
        <span class="tasks-gantt-toolbar-title">Linha do Tempo de Execução & Entregas por Bot</span>
        <div class="tasks-gantt-range-group" role="group" aria-label="Período do gráfico de Gantt">
          {(["6h", "24h", "7d", "30d"] as const).map((key) => (
            <Button
              type="button"
              variant={range() === key ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setRange(key)}
            >
              {key === "6h" ? "Últimas 6h" : key === "24h" ? "Hoje (24h)" : key === "7d" ? "7 Dias" : "30 Dias"}
            </Button>
          ))}
        </div>
      </div>

      <div class="tasks-gantt-legend">
        <span>
          <i class="tasks-gantt-dot" data-tone="attention" /> Depende de Você
        </span>
        <span>
          <i class="tasks-gantt-dot" data-tone="working" /> Fazendo Agora
        </span>
        <span>
          <i class="tasks-gantt-dot" data-tone="queued" /> Na Fila
        </span>
        <span>
          <i class="tasks-gantt-dot" data-tone="delivered" /> Entregue / Concluído
        </span>
      </div>

      <div class="tasks-gantt-board">
        <div class="tasks-gantt-axis">
          <div class="tasks-gantt-agent-col-header">Bot / Tarefa</div>
          <div class="tasks-gantt-track-header">
            <For each={ticks()}>
              {(tick) => (
                <span class="tasks-gantt-tick" style={{ left: `${tick.pct}%` }}>
                  {tick.label}
                </span>
              )}
            </For>
            <span class="tasks-gantt-now-badge">AGORA</span>
          </div>
        </div>

        <Show
          when={rowsByAgent().length > 0}
          fallback={
            <div class="tasks-kanban-empty">
              Nenhuma tarefa registrada neste período. Amplie o período para 7d ou 30d acima.
            </div>
          }
        >
          <For each={rowsByAgent()}>
            {(group) => (
              <div class="tasks-gantt-group">
                <div class="tasks-gantt-group-header">
                  <button
                    type="button"
                    class="tasks-gantt-agent-btn"
                    onClick={() => props.pageProps.onSelectAgentChat?.(group.agent.id)}
                  >
                    <AgentAvatar agent={group.agent} class="tasks-page-avatar" />
                    <strong>{group.agent.name}</strong>
                    <Show when={group.hasAttention}>
                      <span class="tasks-hub-badge" data-tone="attention">
                        🚨 Depende de você
                      </span>
                    </Show>
                    <Show when={group.isWorkingMain}>
                      <span class="tasks-hub-badge" data-tone="working">
                        ⚡ Em execução
                      </span>
                    </Show>
                  </button>
                </div>

                <For each={group.tasks}>
                  {(task) => {
                    const wait = () => props.pageProps.waitOf?.(task);
                    const geom = () => barGeometry(task);
                    const tone = () =>
                      wait()
                        ? "attention"
                        : task.state === "running"
                          ? "working"
                          : task.state === "queued"
                            ? "queued"
                            : "delivered";
                    return (
                      <div
                        class="tasks-gantt-row"
                        data-selected={props.pageProps.selectedId === task.id ? "" : undefined}
                      >
                        <button
                          type="button"
                          class="tasks-gantt-row-label"
                          title={task.title}
                          onClick={() =>
                            props.pageProps.onSelect(
                              props.pageProps.selectedId === task.id ? null : task.id,
                            )
                          }
                        >
                          <AgentTaskMark task={task} decorative />
                          <span class="tasks-gantt-row-title">{task.title}</span>
                        </button>
                        <div class="tasks-gantt-track">
                          <button
                            type="button"
                            class="tasks-gantt-bar"
                            data-tone={tone()}
                            style={{ left: geom().left, width: geom().width }}
                            title={`${task.title} (${geom().durationLabel})${task.progress ? ` — ${task.progress}` : ""}`}
                            onClick={() =>
                              props.pageProps.onSelect(
                                props.pageProps.selectedId === task.id ? null : task.id,
                              )
                            }
                          >
                            <span class="tasks-gantt-bar-text">
                              {task.title} · {geom().durationLabel}
                            </span>
                          </button>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

const SECTION_TITLE = {
  needsYou: "conversation.tasks.section.needsYou",
  working: "conversation.tasks.section.working",
  waiting: "conversation.tasks.section.waiting",
  unread: "conversation.tasks.section.unread",
  read: "conversation.tasks.section.read",
  closed: "conversation.threads.archived",
} as const satisfies Record<TasksSectionId, AppTextKey>;

/** The tasks by what they need, each section with its heading. The archived tasks are faded. */
function TasksList(props: {
  pageProps: TasksPageProps;
  filteredTasks: readonly AgentTask[];
  attentionEntries: readonly UnifiedAttentionEntry[];
}) {
  const { t } = useText();
  const ids = createUniqueId();
  const [view, setView] = createStore({ showAllClosed: false });
  const waitOf = (task: AgentTask) => props.pageProps.waitOf?.(task);
  const sections = () =>
    taskSections(props.filteredTasks, view.showAllClosed, undefined, (task) => waitOf(task) !== undefined);
  return (
    <div class="tasks-list-enhanced">
      <Show when={props.attentionEntries.length > 0}>
        <section class="tasks-hub-urgent-banner" aria-label="Pendências que dependem de você">
          <header class="tasks-hub-urgent-header">
            <strong>🚨 Central de Aprovação Rápida — Depende de Você ({props.attentionEntries.length})</strong>
            <span>Aprove ferramentas, responda dúvidas ou assuma o navegador sem precisar entrar em cada chat</span>
          </header>
          <div class="tasks-hub-urgent-grid">
            <For each={props.attentionEntries}>
              {(entry) => <AttentionActionCard entry={entry} pageProps={props.pageProps} />}
            </For>
          </div>
        </section>
      </Show>

      <For each={sections()} keyed={(section) => section.id}>
        {(section) => (
          <Show when={section().tasks.length > 0}>
            <section
              class="tasks-page-section"
              data-closed={section().id === "closed" ? "" : undefined}
              aria-labelledby={`${ids}-${section().id}`}
            >
              <h3 id={`${ids}-${section().id}`} class="tasks-page-section-heading">
                <span>{t(SECTION_TITLE[section().id])}</span>
                <span class="tasks-page-count">{section().count}</span>
              </h3>
              <ul class="tasks-page-list">
                <For each={section().tasks} keyed={(task) => task.id}>
                  {(task) => (
                    <li data-arrived={props.pageProps.took?.task.id === task().id ? "" : undefined}>
                      <div class="tasks-page-row-enhanced">
                        <TaskRow
                          task={task()}
                          agent={agentOf(props.pageProps.agents, task().agentId)}
                          selected={props.pageProps.selectedId === task().id}
                          wait={waitOf(task())}
                          onOpen={() =>
                            props.pageProps.onSelect(
                              props.pageProps.selectedId === task().id ? null : task().id,
                            )
                          }
                        />
                        <Show when={task().state === "idle" && props.pageProps.onArchiveTask}>
                          <Button
                            type="button"
                            variant="secondary"
                            size="xs"
                            class="tasks-row-quick-approve"
                            title="Aprovar entrega e concluir tarefa"
                            onClick={() => props.pageProps.onArchiveTask?.(task())}
                          >
                            ✅ Aprovar
                          </Button>
                        </Show>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={section().id === "closed" && section().count > TASKS_CLOSED_SHOWN}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="tasks-page-show-all"
                  aria-expanded={view.showAllClosed ? "true" : "false"}
                  onClick={() =>
                    setView((draft) => {
                      draft.showAllClosed = !draft.showAllClosed;
                    })
                  }
                >
                  {view.showAllClosed
                    ? t("conversation.tasks.showLess")
                    : t("conversation.tasks.showAll", { count: section().count })}
                </Button>
              </Show>
            </section>
          </Show>
        )}
      </For>
    </div>
  );
}

/** The close transition is 200ms; this ends a close whose `transitionend` does not come. */
const SIDE_CLOSE_FALLBACK_MS = 300;

export const TASKS_SIDE_DEFAULT = 420;
export const TASKS_SIDE_MIN = 320;
/** What the list keeps for itself, however far the side panel is dragged. */
const TASKS_LIST_MIN = 320;

/**
 * The task panel at the right of the page. It makes the list narrower; it does not cover it. The
 * panel slides in from the right and out again, so it stays shown until its close ends.
 */
function TasksSidePanel(props: {
  tasks: readonly AgentTask[];
  taskId: string | null;
  panel: (taskId: string) => JSX.Element;
  onClose: () => void;
  width: number;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
}) {
  const { t } = useText();
  const sideId = createUniqueId();
  const [view, setView] = createStore<{
    shownId: string | null;
    closing: boolean;
    /** The width of the page, once measured. A narrow page makes the panel narrower, not the saved width. */
    pageWidth: number | null;
  }>({ shownId: untrack(() => props.taskId), closing: false, pageWidth: null });
  let side: HTMLDivElement | undefined;
  /** The list keeps its minimum; a page too narrow for both keeps the panel minimum. */
  const maxFor = (page: number | null | undefined) =>
    page == null ? Number.POSITIVE_INFINITY : Math.max(TASKS_SIDE_MIN, page - TASKS_LIST_MIN);
  const width = () => Math.round(Math.min(maxFor(view.pageWidth), Math.max(TASKS_SIDE_MIN, props.width)));
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const finishClose = () => {
    clearTimeout(closeTimer);
    setView((draft) => {
      draft.shownId = null;
      draft.closing = false;
    });
  };
  createEffect(
    () => props.taskId,
    (taskId) => {
      clearTimeout(closeTimer);
      if (taskId) {
        setView((draft) => {
          draft.shownId = taskId;
          draft.closing = false;
        });
        return;
      }
      if (!untrack(() => view.shownId)) return;
      if (prefersReducedMotion()) return finishClose();
      setView((draft) => {
        draft.closing = true;
      });
      closeTimer = setTimeout(finishClose, SIDE_CLOSE_FALLBACK_MS);
    },
  );
  onCleanup(() => clearTimeout(closeTimer));
  const shown = () => {
    const id = view.shownId;
    return id && props.tasks.some((task) => task.id === id) ? id : null;
  };
  /* The first task of an open slides in with the panel; only a change to a different task fades in. */
  let contentId: string | null = null;
  return (
    <Show when={shown()}>
      {(taskId) => {
        onCleanup(() => {
          contentId = null;
        });
        // Escape closes the panel, as on the settings page: on the document and after the delegated
        // handlers, so a control that handles Escape keeps it. An open popup or another text field also keeps it.
        onSettled(() => {
          const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]")) return;
            if (
              target &&
              !target.closest(".tasks-page") &&
              target.closest("input, textarea, select, [contenteditable]")
            )
              return;
            event.preventDefault();
            props.onClose();
          };
          document.addEventListener("keydown", closeOnEscape);
          return () => document.removeEventListener("keydown", closeOnEscape);
        });
        return (
          <div
            ref={(element) => (side = element)}
            id={sideId}
            class="tasks-page-side"
            style={{ "--tasks-page-side-width": `${width()}px` }}
            data-closing={view.closing ? "" : undefined}
            onTransitionEnd={(event) => {
              if (event.target === event.currentTarget && event.propertyName === "flex-basis" && view.closing) {
                finishClose();
              }
            }}
          >
            <PanelResizer
              class="right-panel-resizer"
              label={t("conversation.tasks.panel.resize")}
              controls={sideId}
              direction="right"
              value={width()}
              defaultValue={TASKS_SIDE_DEFAULT}
              min={TASKS_SIDE_MIN}
              max={() => maxFor(side?.parentElement?.clientWidth)}
              onResize={props.onResize}
              onResizeEnd={props.onResizeEnd}
              onParentResize={() =>
                setView((draft) => {
                  draft.pageWidth = side?.parentElement?.clientWidth ?? null;
                })
              }
            />
            {/* The panel clips its content while it opens and closes; the edge handle stays outside the clip. */}
            <div class="tasks-page-side-clip">
              <For each={[taskId()]} keyed={(id) => id}>
                {(id) => {
                  const current = untrack(id);
                  const entering = contentId !== null && contentId !== current;
                  contentId = current;
                  return (
                    <div class="tasks-page-side-content" data-entering={entering ? "" : undefined}>
                      {props.panel(current)}
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        );
      }}
    </Show>
  );
}

/**
 * The Tasks page of a server, on desktop and on the web: one calm column for the tasks of all agents.
 * The composer is at the top, with the agent selector. Below it, the tasks by what they need. A start
 * can be undone for a few seconds. A task opens in the panel beside the list.
 */
export function TasksPage(props: TasksPageProps) {
  const { t } = useText();
  const headingId = createUniqueId();
  const [viewMode, setViewMode] = createSignal<TasksHubViewMode>(readSavedViewMode());
  const [filterAgentId, setFilterAgentId] = createSignal<string>("");
  const [searchQuery, setSearchQuery] = createSignal<string>("");

  const changeViewMode = (mode: TasksHubViewMode) => {
    setViewMode(mode);
    saveViewMode(mode);
  };

  const attentionEntries = createMemo(() =>
    collectAttentionEntries(props, filterAgentId(), searchQuery()),
  );

  const filteredTasks = createMemo(() => {
    const agentFilter = filterAgentId();
    const query = searchQuery().trim().toLowerCase();
    return props.tasks.filter((task) => {
      if (agentFilter && task.agentId !== agentFilter) return false;
      if (!query) return true;
      const agentName = agentOf(props.agents, task.agentId)?.name?.toLowerCase() ?? "";
      return (
        task.title.toLowerCase().includes(query) ||
        (task.progress?.toLowerCase().includes(query) ?? false) ||
        (task.error?.toLowerCase().includes(query) ?? false) ||
        agentName.includes(query)
      );
    });
  });

  const runningCount = createMemo(
    () =>
      filteredTasks().filter((task) => task.state === "running").length +
      props.agents.filter((a) => Boolean(props.activeTurns?.[a.id])).length,
  );
  const queuedCount = createMemo(
    () =>
      filteredTasks().filter((task) => task.state === "queued").length +
      props.agents.reduce((sum, a) => sum + (props.queues?.[a.id]?.deliveries?.length ?? 0), 0),
  );
  const deliveredCount = createMemo(
    () => filteredTasks().filter((task) => task.state === "idle" || task.state === "closed").length,
  );

  // The first start adds a task that waits, so the page shows the list as soon as the user sends.
  const empty = () =>
    props.loaded === true &&
    props.tasks.length === 0 &&
    attentionEntries().length === 0 &&
    runningCount() === 0 &&
    queuedCount() === 0;

  return (
    <section
      class="tasks-page"
      aria-labelledby={headingId}
      data-empty={empty() ? "" : undefined}
      data-view-mode={viewMode()}
    >
      <div class="tasks-page-scroll">
        <div class="tasks-page-column">
          <PageHeader
            class="tasks-page-header"
            title={t("conversation.tasks.title")}
            hostName={props.hostName}
            headingId={headingId}
            onBack={props.onBack}
            frame={props.frame}
          />
          <Show when={empty()}>
            <TasksEmptyPitch />
          </Show>
          <TasksComposer {...props} />
          <div class="tasks-page-took-slot" aria-live="polite">
            <Show when={props.took}>{(took) => <TaskTookLine {...props} took={took()} />}</Show>
          </div>

          <div class="tasks-hub-toolbar">
            <div class="tasks-hub-toolbar-row">
              <div class="tasks-hub-modes" role="tablist" aria-label="Visualização de Tarefas">
                <Button
                  type="button"
                  variant={viewMode() === "kanban" ? "secondary" : "ghost"}
                  size="sm"
                  role="tab"
                  aria-selected={viewMode() === "kanban" ? "true" : "false"}
                  onClick={() => changeViewMode("kanban")}
                >
                  🗂️ Kanban
                </Button>
                <Button
                  type="button"
                  variant={viewMode() === "gantt" ? "secondary" : "ghost"}
                  size="sm"
                  role="tab"
                  aria-selected={viewMode() === "gantt" ? "true" : "false"}
                  onClick={() => changeViewMode("gantt")}
                >
                  📊 Gantt
                </Button>
                <Button
                  type="button"
                  variant={viewMode() === "list" ? "secondary" : "ghost"}
                  size="sm"
                  role="tab"
                  aria-selected={viewMode() === "list" ? "true" : "false"}
                  onClick={() => changeViewMode("list")}
                >
                  📋 Tarefas
                </Button>
              </div>

              <div class="tasks-hub-kpis">
                <span
                  class="tasks-hub-kpi"
                  data-tone={attentionEntries().length > 0 ? "attention" : "neutral"}
                >
                  🚨 <strong>{attentionEntries().length}</strong> Depende de Mim
                </span>
                <span class="tasks-hub-kpi" data-tone="working">
                  ⚡ <strong>{runningCount()}</strong> Fazendo
                </span>
                <span class="tasks-hub-kpi" data-tone="queued">
                  ⏳ <strong>{queuedCount()}</strong> Fila
                </span>
                <span class="tasks-hub-kpi" data-tone="delivered">
                  ✅ <strong>{deliveredCount()}</strong> Entregues
                </span>
              </div>

              <div class="tasks-hub-search">
                <Search aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Buscar tarefa, entrega ou bot..."
                  value={searchQuery()}
                  onInput={(event) => setSearchQuery(event.currentTarget.value)}
                />
              </div>
            </div>

            <div class="tasks-hub-agents-bar" role="group" aria-label="Filtrar por Bot">
              <Button
                type="button"
                variant={filterAgentId() === "" ? "secondary" : "ghost"}
                size="xs"
                onClick={() => setFilterAgentId("")}
              >
                Todos os Bots ({props.agents.length})
              </Button>
              <For each={props.agents}>
                {(agent) => {
                  const agentCount = () =>
                    props.tasks.filter((t) => t.agentId === agent.id && t.state !== "closed").length +
                    (props.activeTurns?.[agent.id] ? 1 : 0);
                  return (
                    <Button
                      type="button"
                      variant={filterAgentId() === agent.id ? "secondary" : "ghost"}
                      size="xs"
                      class="tasks-hub-agent-filter-btn"
                      onClick={() =>
                        setFilterAgentId(filterAgentId() === agent.id ? "" : agent.id)
                      }
                    >
                      <AgentAvatar agent={agent} class="tasks-page-avatar" />
                      <span>{agent.name}</span>
                      <Show when={agentCount() > 0}>
                        <span class="tasks-hub-agent-count">{agentCount()}</span>
                      </Show>
                    </Button>
                  );
                }}
              </For>
            </div>
          </div>

          <Show when={viewMode() === "kanban"}>
            <TasksKanbanBoard
              pageProps={props}
              filteredTasks={filteredTasks()}
              attentionEntries={attentionEntries()}
              filterAgentId={filterAgentId()}
            />
          </Show>
          <Show when={viewMode() === "gantt"}>
            <TasksGanttTimeline
              pageProps={props}
              filteredTasks={filteredTasks()}
              attentionEntries={attentionEntries()}
              filterAgentId={filterAgentId()}
            />
          </Show>
          <Show when={viewMode() === "list"}>
            <TasksList
              pageProps={props}
              filteredTasks={filteredTasks()}
              attentionEntries={attentionEntries()}
            />
          </Show>

          <Show when={empty() && viewMode() === "list"}>
            <TasksEmptyBoard agents={props.agents} />
          </Show>
        </div>
      </div>
      <TasksSidePanel
        tasks={props.tasks}
        taskId={props.selectedId}
        panel={props.panel}
        onClose={() => props.onSelect(null)}
        width={props.sideWidth}
        onResize={props.onSideResize}
        onResizeEnd={props.onSideResizeEnd}
      />
    </section>
  );
}
