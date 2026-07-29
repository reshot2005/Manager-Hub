import React, { useEffect, useRef, useState, useCallback, createContext, useContext, forwardRef } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  ArrowUp,
  Paperclip,
  Square,
  X,
  StopCircle,
  Mic,
  Globe,
  BrainCog,
  FolderCode,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

let stylesInjected = false;
function ensurePromptStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const el = document.createElement('style');
  el.setAttribute('data-ai-prompt-box', 'true');
  el.textContent = `
    .ai-prompt-box textarea::-webkit-scrollbar { width: 6px; }
    .ai-prompt-box textarea::-webkit-scrollbar-track { background: transparent; }
    .ai-prompt-box textarea::-webkit-scrollbar-thumb { background-color: #444444; border-radius: 3px; }
    .ai-prompt-box textarea::-webkit-scrollbar-thumb:hover { background-color: #555555; }
  `;
  document.head.appendChild(el);
}

const Textarea = forwardRef(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      className={cn(
        'flex min-h-[44px] w-full resize-none rounded-md border-none bg-transparent px-3 py-2.5 text-base text-gray-100 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      ref={ref}
      rows={1}
      {...props}
    />
  );
});

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;
const TooltipContent = forwardRef(function TooltipContent(
  { className, sideOffset = 4, ...props },
  ref
) {
  return (
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 overflow-hidden rounded-md border border-[#333333] bg-[#1F2023] px-3 py-1.5 text-sm text-white shadow-md',
        className
      )}
      {...props}
    />
  );
});

const Dialog = DialogPrimitive.Root;
const DialogPortal = DialogPrimitive.Portal;
const DialogOverlay = forwardRef(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out',
        className
      )}
      {...props}
    />
  );
});

const DialogContent = forwardRef(function DialogContent({ className, children, ...props }, ref) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-[50%] top-[50%] z-50 grid w-full max-w-[90vw] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-2xl border border-[#333333] bg-[#1F2023] p-0 shadow-xl md:max-w-[800px]',
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 z-10 rounded-full bg-[#2E3033]/80 p-2 transition-all hover:bg-[#2E3033]">
          <X className="h-5 w-5 text-gray-200 hover:text-white" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

const DialogTitle = forwardRef(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('text-lg font-semibold leading-none tracking-tight text-gray-100', className)}
      {...props}
    />
  );
});

const Button = forwardRef(function Button(
  { className, variant = 'default', size = 'default', ...props },
  ref
) {
  const variantClasses = {
    default: 'bg-white hover:bg-white/80 text-black',
    outline: 'border border-[#444444] bg-transparent hover:bg-[#3A3A40]',
    ghost: 'bg-transparent hover:bg-[#3A3A40]',
  };
  const sizeClasses = {
    default: 'h-10 px-4 py-2',
    sm: 'h-8 px-3 text-sm',
    lg: 'h-12 px-6',
    icon: 'h-8 w-8 rounded-full aspect-[1/1]',
  };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      ref={ref}
      {...props}
    />
  );
});

function VoiceRecorder({ isRecording, onStartRecording, onStopRecording, visualizerBars = 32 }) {
  const [time, setTime] = useState(0);
  const timerRef = useRef(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (isRecording) {
      startedRef.current = true;
      onStartRecording?.();
      timerRef.current = setInterval(() => setTime((t) => t + 1), 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (startedRef.current) {
        onStopRecording?.(time);
        startedRef.current = false;
      }
      setTime(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // intentionally omit time / callbacks to avoid restart loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={cn(
        'flex w-full flex-col items-center justify-center py-3 transition-all duration-300',
        isRecording ? 'opacity-100' : 'h-0 opacity-0'
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
        <span className="font-mono text-sm text-white/80">{formatTime(time)}</span>
      </div>
      <div className="flex h-10 w-full items-center justify-center gap-0.5 px-4">
        {[...Array(visualizerBars)].map((_, i) => (
          <div
            key={i}
            className="w-0.5 animate-pulse rounded-full bg-white/50"
            style={{
              height: `${Math.max(15, ((i * 37) % 85) + 15)}%`,
              animationDelay: `${i * 0.05}s`,
              animationDuration: `${0.5 + (i % 5) * 0.1}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ImageViewDialog({ imageUrl, onClose }) {
  if (!imageUrl) return null;
  return (
    <Dialog open={!!imageUrl} onOpenChange={onClose}>
      <DialogContent className="max-w-[90vw] border-none bg-transparent p-0 shadow-none md:max-w-[800px]">
        <DialogTitle className="sr-only">Image Preview</DialogTitle>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="relative overflow-hidden rounded-2xl bg-[#1F2023] shadow-2xl"
        >
          <img src={imageUrl} alt="Full preview" className="max-h-[80vh] w-full rounded-2xl object-contain" />
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}

const PromptInputContext = createContext(null);

function usePromptInput() {
  const context = useContext(PromptInputContext);
  if (!context) throw new Error('usePromptInput must be used within a PromptInput');
  return context;
}

const PromptInput = forwardRef(function PromptInput(
  {
    className,
    isLoading = false,
    maxHeight = 240,
    value,
    onValueChange,
    onSubmit,
    children,
    disabled = false,
    onDragOver,
    onDragLeave,
    onDrop,
  },
  ref
) {
  const [internalValue, setInternalValue] = useState(value || '');
  const handleChange = (newValue) => {
    setInternalValue(newValue);
    onValueChange?.(newValue);
  };
  return (
    <TooltipProvider delayDuration={200}>
      <PromptInputContext.Provider
        value={{
          isLoading,
          value: value ?? internalValue,
          setValue: onValueChange ?? handleChange,
          maxHeight,
          onSubmit,
          disabled,
        }}
      >
        <div
          ref={ref}
          className={cn(
            'ai-prompt-box rounded-3xl border border-[#444444] bg-[#1F2023] p-2 shadow-[0_8px_30px_rgba(0,0,0,0.24)] transition-all duration-300',
            isLoading && 'border-teal-500/70',
            className
          )}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {children}
        </div>
      </PromptInputContext.Provider>
    </TooltipProvider>
  );
});

function PromptInputTextarea({
  className,
  onKeyDown,
  disableAutosize = false,
  placeholder,
  ...props
}) {
  const { value, setValue, maxHeight, onSubmit, disabled } = usePromptInput();
  const textareaRef = useRef(null);

  useEffect(() => {
    if (disableAutosize || !textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height =
      typeof maxHeight === 'number'
        ? `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`
        : `min(${textareaRef.current.scrollHeight}px, ${maxHeight})`;
  }, [value, maxHeight, disableAutosize]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit?.();
    }
    onKeyDown?.(e);
  };

  return (
    <Textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      className={cn('text-base', className)}
      disabled={disabled}
      placeholder={placeholder}
      {...props}
    />
  );
}

function PromptInputActions({ children, className, ...props }) {
  return (
    <div className={cn('flex items-center gap-2', className)} {...props}>
      {children}
    </div>
  );
}

function PromptInputAction({ tooltip, children, className, side = 'top', ...props }) {
  const { disabled } = usePromptInput();
  return (
    <Tooltip {...props}>
      <TooltipTrigger asChild disabled={disabled}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} className={className}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function CustomDivider() {
  return (
    <div className="relative mx-1 h-6 w-[1.5px]">
      <div
        className="absolute inset-0 rounded-full bg-gradient-to-t from-transparent via-teal-400/70 to-transparent"
        style={{
          clipPath:
            'polygon(0% 0%, 100% 0%, 100% 40%, 140% 50%, 100% 60%, 100% 100%, 0% 100%, 0% 60%, -40% 50%, 0% 40%)',
        }}
      />
    </div>
  );
}

export const PromptInputBox = forwardRef(function PromptInputBox(props, ref) {
  const {
    onSend = () => {},
    isLoading = false,
    placeholder = 'Ask Manager AI anything about your team…',
    className,
  } = props;

  useEffect(() => {
    ensurePromptStyles();
  }, []);

  const [input, setInput] = useState('');
  const [files, setFiles] = useState([]);
  const [filePreviews, setFilePreviews] = useState({});
  const [selectedImage, setSelectedImage] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showThink, setShowThink] = useState(false);
  const [showCanvas, setShowCanvas] = useState(false);
  const uploadInputRef = useRef(null);
  const promptBoxRef = useRef(null);
  const stopDurationRef = useRef(0);

  const handleToggleChange = (value) => {
    if (value === 'search') {
      setShowSearch((prev) => !prev);
      setShowThink(false);
    } else if (value === 'think') {
      setShowThink((prev) => !prev);
      setShowSearch(false);
    }
  };

  const handleCanvasToggle = () => setShowCanvas((prev) => !prev);

  const isImageFile = (file) => file.type.startsWith('image/');

  const processFile = (file) => {
    if (!isImageFile(file)) return;
    if (file.size > 10 * 1024 * 1024) return;
    setFiles([file]);
    const reader = new FileReader();
    reader.onload = (e) => setFilePreviews({ [file.name]: e.target?.result });
    reader.readAsDataURL(file);
  };

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const dropped = Array.from(e.dataTransfer.files || []);
    const imageFiles = dropped.filter((file) => isImageFile(file));
    if (imageFiles.length > 0) processFile(imageFiles[0]);
  }, []);

  const handleRemoveFile = (index) => {
    const fileToRemove = files[index];
    if (fileToRemove && filePreviews[fileToRemove.name]) setFilePreviews({});
    setFiles([]);
  };

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          processFile(file);
          break;
        }
      }
    }
  }, []);

  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  const handleSubmit = () => {
    if (input.trim() || files.length > 0) {
      let messagePrefix = '';
      if (showSearch) messagePrefix = '[Search: ';
      else if (showThink) messagePrefix = '[Think: ';
      else if (showCanvas) messagePrefix = '[Canvas: ';
      const formattedInput = messagePrefix ? `${messagePrefix}${input}]` : input;
      onSend(formattedInput, files);
      setInput('');
      setFiles([]);
      setFilePreviews({});
    }
  };

  const handleStartRecording = () => {
    stopDurationRef.current = 0;
  };

  const handleStopRecording = (duration) => {
    stopDurationRef.current = duration;
    setIsRecording(false);
    if (duration > 0) {
      onSend(
        `[Voice note — ${duration}s] Please help based on my spoken request about the team. (Voice transcription coming soon — type your question for now.)`,
        []
      );
    }
  };

  const hasContent = input.trim() !== '' || files.length > 0;

  return (
    <>
      <PromptInput
        value={input}
        onValueChange={setInput}
        isLoading={isLoading}
        onSubmit={handleSubmit}
        className={cn(
          'w-full border-[#444444] bg-[#1F2023] shadow-[0_8px_30px_rgba(0,0,0,0.24)] transition-all duration-300 ease-in-out',
          isRecording && 'border-red-500/70',
          className
        )}
        disabled={isLoading || isRecording}
        ref={ref || promptBoxRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {files.length > 0 && !isRecording && (
          <div className="flex flex-wrap gap-2 p-0 pb-1 transition-all duration-300">
            {files.map((file, index) => (
              <div key={index} className="group relative">
                {file.type.startsWith('image/') && filePreviews[file.name] && (
                  <div
                    className="h-16 w-16 cursor-pointer overflow-hidden rounded-xl transition-all duration-300"
                    onClick={() => setSelectedImage(filePreviews[file.name])}
                  >
                    <img
                      src={filePreviews[file.name]}
                      alt={file.name}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFile(index);
                      }}
                      className="absolute right-1 top-1 rounded-full bg-black/70 p-0.5 opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3 text-white" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div
          className={cn(
            'transition-all duration-300',
            isRecording ? 'h-0 overflow-hidden opacity-0' : 'opacity-100'
          )}
        >
          <PromptInputTextarea
            placeholder={
              showSearch
                ? 'Search the hub deeply…'
                : showThink
                  ? 'Think deeply about the team…'
                  : showCanvas
                    ? 'Draft a structured report…'
                    : placeholder
            }
            className="text-base"
          />
        </div>

        {isRecording && (
          <VoiceRecorder
            isRecording={isRecording}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
          />
        )}

        <PromptInputActions className="flex items-center justify-between gap-2 p-0 pt-2">
          <div
            className={cn(
              'flex items-center gap-1 transition-opacity duration-300',
              isRecording ? 'invisible h-0 opacity-0' : 'visible opacity-100'
            )}
          >
            <PromptInputAction tooltip="Upload image">
              <button
                type="button"
                onClick={() => uploadInputRef.current?.click()}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-[#9CA3AF] transition-colors hover:bg-gray-600/30 hover:text-[#D1D5DB]"
                disabled={isRecording}
              >
                <Paperclip className="h-5 w-5 transition-colors" />
                <input
                  ref={uploadInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) processFile(e.target.files[0]);
                    if (e.target) e.target.value = '';
                  }}
                  accept="image/*"
                />
              </button>
            </PromptInputAction>

            <div className="flex items-center">
              <button
                type="button"
                onClick={() => handleToggleChange('search')}
                className={cn(
                  'flex h-8 items-center gap-1 rounded-full border px-2 py-1 transition-all',
                  showSearch
                    ? 'border-teal-400 bg-teal-400/15 text-teal-300'
                    : 'border-transparent bg-transparent text-[#9CA3AF] hover:text-[#D1D5DB]'
                )}
              >
                <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
                  <motion.div
                    animate={{ rotate: showSearch ? 360 : 0, scale: showSearch ? 1.1 : 1 }}
                    whileHover={{
                      rotate: showSearch ? 360 : 15,
                      scale: 1.1,
                      transition: { type: 'spring', stiffness: 300, damping: 10 },
                    }}
                    transition={{ type: 'spring', stiffness: 260, damping: 25 }}
                  >
                    <Globe className={cn('h-4 w-4', showSearch ? 'text-teal-300' : 'text-inherit')} />
                  </motion.div>
                </div>
                <AnimatePresence>
                  {showSearch && (
                    <motion.span
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 'auto', opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="flex-shrink-0 overflow-hidden whitespace-nowrap text-xs text-teal-300"
                    >
                      Search
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>

              <CustomDivider />

              <button
                type="button"
                onClick={() => handleToggleChange('think')}
                className={cn(
                  'flex h-8 items-center gap-1 rounded-full border px-2 py-1 transition-all',
                  showThink
                    ? 'border-violet-400 bg-violet-400/15 text-violet-300'
                    : 'border-transparent bg-transparent text-[#9CA3AF] hover:text-[#D1D5DB]'
                )}
              >
                <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
                  <motion.div
                    animate={{ rotate: showThink ? 360 : 0, scale: showThink ? 1.1 : 1 }}
                    whileHover={{
                      rotate: showThink ? 360 : 15,
                      scale: 1.1,
                      transition: { type: 'spring', stiffness: 300, damping: 10 },
                    }}
                    transition={{ type: 'spring', stiffness: 260, damping: 25 }}
                  >
                    <BrainCog className={cn('h-4 w-4', showThink ? 'text-violet-300' : 'text-inherit')} />
                  </motion.div>
                </div>
                <AnimatePresence>
                  {showThink && (
                    <motion.span
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 'auto', opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="flex-shrink-0 overflow-hidden whitespace-nowrap text-xs text-violet-300"
                    >
                      Think
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>

              <CustomDivider />

              <button
                type="button"
                onClick={handleCanvasToggle}
                className={cn(
                  'flex h-8 items-center gap-1 rounded-full border px-2 py-1 transition-all',
                  showCanvas
                    ? 'border-orange-400 bg-orange-400/15 text-orange-300'
                    : 'border-transparent bg-transparent text-[#9CA3AF] hover:text-[#D1D5DB]'
                )}
              >
                <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
                  <motion.div
                    animate={{ rotate: showCanvas ? 360 : 0, scale: showCanvas ? 1.1 : 1 }}
                    whileHover={{
                      rotate: showCanvas ? 360 : 15,
                      scale: 1.1,
                      transition: { type: 'spring', stiffness: 300, damping: 10 },
                    }}
                    transition={{ type: 'spring', stiffness: 260, damping: 25 }}
                  >
                    <FolderCode
                      className={cn('h-4 w-4', showCanvas ? 'text-orange-300' : 'text-inherit')}
                    />
                  </motion.div>
                </div>
                <AnimatePresence>
                  {showCanvas && (
                    <motion.span
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 'auto', opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="flex-shrink-0 overflow-hidden whitespace-nowrap text-xs text-orange-300"
                    >
                      Canvas
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            </div>
          </div>

          <PromptInputAction
            tooltip={
              isLoading
                ? 'Stop generation'
                : isRecording
                  ? 'Stop recording'
                  : hasContent
                    ? 'Send message'
                    : 'Voice message'
            }
          >
            <Button
              variant="default"
              size="icon"
              className={cn(
                'h-8 w-8 rounded-full transition-all duration-200',
                isRecording
                  ? 'bg-transparent text-red-500 hover:bg-gray-600/30 hover:text-red-400'
                  : hasContent
                    ? 'bg-white text-[#1F2023] hover:bg-white/80'
                    : 'bg-transparent text-[#9CA3AF] hover:bg-gray-600/30 hover:text-[#D1D5DB]'
              )}
              onClick={() => {
                if (isRecording) setIsRecording(false);
                else if (hasContent) handleSubmit();
                else setIsRecording(true);
              }}
              disabled={isLoading && !hasContent}
            >
              {isLoading ? (
                <Square className="h-4 w-4 animate-pulse fill-[#1F2023]" />
              ) : isRecording ? (
                <StopCircle className="h-5 w-5 text-red-500" />
              ) : hasContent ? (
                <ArrowUp className="h-4 w-4 text-[#1F2023]" />
              ) : (
                <Mic className="h-5 w-5 text-[#9CA3AF] transition-colors" />
              )}
            </Button>
          </PromptInputAction>
        </PromptInputActions>
      </PromptInput>

      <ImageViewDialog imageUrl={selectedImage} onClose={() => setSelectedImage(null)} />
    </>
  );
});

PromptInputBox.displayName = 'PromptInputBox';
