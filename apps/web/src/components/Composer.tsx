import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent, KeyboardEvent, ReactNode } from "react";
import type { ImageAttachment } from "@somecode/protocol";
import { byteLength, checkText, formatBytes, looksLikeText, MAX_FILE_BYTES, MAX_TOTAL_BYTES, withAttachedFiles, type AttachedFile } from "../lib/attachedFiles.ts";
import { SymbolIcon } from "./SymbolIcon.tsx";
import { FileIcon } from "./FileIcon.tsx";
import type { WorkspaceApi } from "../lib/workspaceApi.ts";
import { t } from "../i18n/index.ts";

const MAX_LINES = 12;
const FALLBACK_LINE_PX = 24;

export interface SlashCommand {
  command: string;
  name: string;
  description: string;
  icon: 'goal' | 'compass' | 'globe' | 'layers' | 'book' | 'search' | 'research' | 'shield';
  /** Only in a chat that exists (it acts on the chat itself). */
  inChat?: boolean;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: '/goal',
    name: '/goal',
    description: 'Hedef odaklı otonom mod: Testleri geçene ve çözene kadar durmadan çalışır',
    icon: 'goal',
  },
  {
    command: '/plan',
    name: '/plan',
    description: 'Planlama modu: Kod yazmadan önce adımları ve mimariyi detaylı planlar',
    icon: 'compass',
  },
  {
    command: '/deep-research',
    name: '/deep-research',
    description: 'Derin araştırma: Plan çıkarır, Google/Yandex/Bing ile çok kaynaktan inceler ve kaynaklı rapor yazar',
    icon: 'research',
  },
  {
    command: '/browser',
    name: '/browser',
    description: 'Web & Araştırma: İnternette arama yap ve kaynakları incele',
    icon: 'globe',
  },
  {
    command: '/compact',
    name: '/compact',
    description: 'Bağlamı sıkıştır: Sohbet geçmişini özetleyip bağlamı rahatlat',
    icon: 'layers',
  },
  {
    command: '/verify',
    name: '/verify',
    description: 'Kontrolleri çalıştır: Projenin test, typecheck ve lint komutlarını şimdi çalıştır',
    icon: 'shield',
    inChat: true,
  },
  {
    command: '/learn',
    name: '/learn',
    description: 'Kuralları kaydet: Projeye özel kuralları ve deneyimleri kaydet',
    icon: 'book',
  },
];

export interface ComposerProps {
  /** The box belongs to a chat that exists (a new-chat screen has no chat to act on). */
  inChat?: boolean;
  /** Replaces "Message the agent" as the hint of an empty box. */
  placeholder?: string;
  /** Controls shown inside the composer, left of the send button (e.g. model and mode chips). */
  toolbar?: ReactNode;
  projectId?: string;
  workspaceApi?: WorkspaceApi;
  value: string;
  onChange: (value: string) => void;
  /** A turn is in flight: Send becomes Stop, Enter no longer sends (typing the next message stays possible). */
  running: boolean;
  disabled: boolean;
  disableSend?: boolean;
  sendDisabledTooltip?: string;
  disabledPlaceholder?: string;
  /** Receives the trimmed text and any attached images. */
  onSend: (text: string, attachments?: ImageAttachment[]) => void;
  onCancel: () => void;
}

function maxHeightPx(el: HTMLTextAreaElement): number {
  const lh = Number.parseFloat(getComputedStyle(el).lineHeight);
  return (Number.isFinite(lh) && lh > 0 ? lh : FALLBACK_LINE_PX) * MAX_LINES;
}

export function Composer({
  toolbar,
  projectId,
  workspaceApi,
  value,
  onChange,
  running,
  disabled,
  disableSend,
  sendDisabledTooltip,
  disabledPlaceholder,
  placeholder,
  inChat = false,
  onSend,
  onCancel,
}: ComposerProps) {
  const [matches, setMatches] = useState<string[]>([]);
  const [slashMatches, setSlashMatches] = useState<SlashCommand[]>([]);
  const [slashSelected, setSlashSelected] = useState(0);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const sentRef = useRef(false);

  // File mentions (@)
  const mention = /@([^\s@]*)$/.exec(value);
  const query = mention?.[1];

  useEffect(() => {
    let alive = true;
    if (query === undefined || !projectId || !workspaceApi) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      void workspaceApi
        .search(projectId, query)
        .then((r) => {
          if (alive) setMatches(r.paths);
        })
        .catch(() => {
          if (alive) setMatches([]);
        });
    }, 160);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, projectId, workspaceApi]);

  // Slash commands (/)
  useEffect(() => {
    if (value.startsWith('/') && !value.includes(' ') && !value.includes('\n')) {
      const q = value.toLowerCase();
      const filtered = SLASH_COMMANDS.filter((cmd) => (cmd.inChat !== true || inChat) && cmd.command.toLowerCase().startsWith(q));
      setSlashMatches(filtered);
      setSlashSelected(0);
    } else {
      setSlashMatches([]);
    }
  }, [value]);

  const canSend = (value.trim() !== "" || attachments.length > 0 || files.length > 0) && !running && !disabled && !disableSend;

  const prevValue = useRef(value);
  const prevRunning = useRef(running);
  const prevDisabled = useRef(disabled);
  const prevDisableSend = useRef(disableSend);

  useEffect(() => {
    if (
      prevValue.current !== value ||
      prevRunning.current !== running ||
      prevDisabled.current !== disabled ||
      prevDisableSend.current !== disableSend
    ) {
      sentRef.current = false;
      prevValue.current = value;
      prevRunning.current = running;
      prevDisabled.current = disabled;
      prevDisableSend.current = disableSend;
    }
  }, [value, running, disabled, disableSend]);

  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled]);

  const fit = () => {
    const el = ref.current;
    if (!el) return;
    const max = maxHeightPx(el);
    el.style.height = "auto";
    const h = Math.min(el.scrollHeight, max);
    el.style.height = `${h}px`;
    el.style.maxHeight = `${max}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  };
  useLayoutEffect(fit, [value]);
  // The box can be measured while it is still narrow (a view that is opening): its placeholder then wraps into a
  // tall column and the box stays tall. Measure again whenever its width changes.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addTextFile = async (file: File) => {
    const fail = (key: 'attach.binary' | 'attach.tooLarge' | 'attach.total') => setAttachError(t(key, { name: file.name }));
    if (!looksLikeText(file)) return fail('attach.binary');
    if (file.size > MAX_FILE_BYTES) return fail('attach.tooLarge');
    const checked = checkText(await file.text(), file.size);
    if (!checked.ok) return fail(checked.reason === 'binary' ? 'attach.binary' : 'attach.tooLarge');
    setFiles((prev) => {
      if (prev.reduce((n, f) => n + byteLength(f.text), 0) + file.size > MAX_TOTAL_BYTES) {
        fail('attach.total');
        return prev;
      }
      setAttachError(null);
      return [...prev, { name: file.name, text: checked.text }];
    });
  };

  const handleFiles = (incoming: FileList | File[]) => {
    for (const file of Array.from(incoming)) {
      if (!file.type.startsWith('image/')) {
        void addTextFile(file);
        continue;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = (e.target?.result as string) || '';
        const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1]! : dataUrl;
        setAttachments((prev) => [
          ...prev,
          {
            data: base64Data,
            mimeType: file.type || 'image/png',
            name: file.name,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      handleFiles(files);
    }
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const send = () => {
    if (!canSend || sentRef.current) return;
    sentRef.current = true;
    try {
      const atts = attachments;
      const sentFiles = files;
      if (attachments.length > 0) {
        setAttachments([]);
      }
      if (sentFiles.length > 0) setFiles([]);
      setAttachError(null);
      onSend(withAttachedFiles(value.trim(), sentFiles), atts);
    } catch (err) {
      sentRef.current = false;
      throw err;
    }
    setTimeout(() => {
      sentRef.current = false;
    }, 0);
    ref.current?.focus();
  };

  const stop = () => {
    onCancel();
    ref.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle slash menu keyboard selection
    if (slashMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelected((prev) => (prev + 1) % slashMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelected((prev) => (prev - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const picked = slashMatches[slashSelected];
        if (picked) {
          onChange(`${picked.command} `);
          setSlashMatches([]);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashMatches([]);
        return;
      }
    }

    if (e.key !== "Enter") return;
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.shiftKey) return;
    if (e.altKey) return;
    e.preventDefault();
    send();
  };

  return (
    <div
      className={`composer relative font-ui ${isDragging ? "ring-2 ring-accent" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* File Mentions Menu */}
      {matches.length > 0 && (
        <div className="mention-menu" aria-label={t("chat.mention")}>
          {matches.slice(0, 12).map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => {
                onChange(value.replace(/@[^\s@]*$/, `@${path} `));
                setMatches([]);
                ref.current?.focus();
              }}
            >
              <FileIcon path={path} className="size-4 shrink-0" />
              <span>{path}</span>
            </button>
          ))}
        </div>
      )}

      {/* Slash Commands Menu */}
      {slashMatches.length > 0 && (
        <div className="slash-menu" aria-label="Slash commands">
          <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Komutlar (Slash Commands)
          </div>
          {slashMatches.map((cmd, i) => (
            <button
              key={cmd.command}
              type="button"
              className={`slash-menu-item ${i === slashSelected ? "active" : ""}`}
              onClick={() => {
                onChange(`${cmd.command} `);
                setSlashMatches([]);
                ref.current?.focus();
              }}
              onMouseEnter={() => setSlashSelected(i)}
            >
              <SymbolIcon name={cmd.icon} className="size-4 text-accent" />
              <div className="min-w-0 flex-1">
                <span className="font-semibold text-text">{cmd.name}</span>
                <span className="ml-2 text-xs text-text-muted">{cmd.description}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="composer-surface">
        {(files.length > 0 || attachError) && (
          <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
            {files.map((f, i) => (
              <span key={`${f.name}:${i}`} className="file-chip">
                <FileIcon path={f.name} className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">{f.name}</span>
                <span className="text-text-muted">{formatBytes(byteLength(f.text))}</span>
                <button type="button" className="file-chip-remove" aria-label={t('composer.removeAttachment', { name: f.name })} onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                  <SymbolIcon name="close" className="size-3" />
                </button>
              </span>
            ))}
            {attachError && <p role="alert" className="text-[12.5px] text-danger">{attachError}</p>}
          </div>
        )}
        {/* Attachment Preview Strip (Image Thumbnail Cards at top) */}
        {attachments.length > 0 && (
          <div className="composer-attachments flex flex-wrap gap-2.5 px-1 pb-2">
            {attachments.map((att, i) => {
              const src = att.data.startsWith("data:") ? att.data : `data:${att.mimeType};base64,${att.data}`;
              return (
                <div
                  key={i}
                  className="group relative overflow-hidden rounded-xl border border-border/70 bg-[#141416] p-1 shadow-md transition"
                >
                  <img
                    src={src}
                    alt={att.name || "Attachment"}
                    className="h-16 w-20 rounded-lg object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-black/80 text-white shadow-sm transition hover:scale-110 hover:bg-black"
                    title="Kaldır"
                  >
                    <SymbolIcon name="close" className="size-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          aria-label={t("composer.label")}
          title={t("composer.hint")}
          placeholder={disabled && disabledPlaceholder ? disabledPlaceholder : (placeholder ?? t("chat.placeholder"))}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="composer-input"
        />

        <div className="composer-bar">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {/* Image Attachment Button (+) */}
            <input
              type="file"
              ref={fileInputRef}
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={t('composer.attach')}
              title={t('composer.attach')}
              onClick={() => fileInputRef.current?.click()}
            >
              <SymbolIcon name="plus" className="size-4" />
            </button>

            {projectId && (
              <button
                type="button"
                className="icon-button"
                aria-label={t("chat.mention")}
                title={t("chat.mention")}
                onClick={() => {
                  onChange(value + " @");
                  ref.current?.focus();
                }}
              >
                <SymbolIcon name="at" className="size-4" />
              </button>
            )}

            {toolbar}
          </div>

          <div className="flex items-center gap-1.5">
            {/* Voice input button */}
            <button
              type="button"
              className="icon-button text-text-muted hover:text-text"
              aria-label="Sesle yaz"
              title="Sesle yaz"
            >
              <SymbolIcon name="mic" className="size-4" />
            </button>

            {running ? (
              <button
                type="button"
                onClick={stop}
                aria-label={t("composer.stop")}
                title={t("composer.stop")}
                className="send-button send-stop"
              >
                <SymbolIcon name="stop" className="size-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!canSend}
                onClick={send}
                aria-label={t("chat.send")}
                title={disableSend && sendDisabledTooltip ? sendDisabledTooltip : t("chat.send")}
                className={`send-button ${disableSend ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                <SymbolIcon name="arrow" className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
