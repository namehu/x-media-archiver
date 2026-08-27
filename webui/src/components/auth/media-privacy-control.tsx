import { useState } from "react";
import { EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function MediaPrivacyButton() {
  const control = useMediaPrivacyControl();

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={control.requestToggle}
            disabled={control.pending}
            className={cn(
              "hidden text-fg-tertiary hover:text-fg-primary sm:inline-flex",
              control.enabled && "bg-brand-soft text-brand hover:bg-brand-soft hover:text-brand",
            )}
            aria-label={control.enabled ? "关闭媒体隐私模式" : "开启媒体隐私模式"}
            aria-pressed={control.enabled}
          >
            <EyeOff aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {control.enabled ? "媒体隐私模式已开启" : "开启媒体隐私模式"}
        </TooltipContent>
      </Tooltip>
      <DisablePrivacyDialog control={control} />
    </>
  );
}

export function MediaPrivacyMenuItem() {
  const control = useMediaPrivacyControl();

  return (
    <>
      <DropdownMenuItem
        className="flex sm:hidden"
        onSelect={(event) => event.preventDefault()}
        onClick={control.requestToggle}
        disabled={control.pending}
      >
        <EyeOff className="mr-2 size-4" aria-hidden="true" />
        <span className="flex-1">媒体隐私模式</span>
        <Switch checked={control.enabled} tabIndex={-1} aria-hidden="true" />
      </DropdownMenuItem>
      <DisablePrivacyDialog control={control} />
    </>
  );
}

type PrivacyControl = ReturnType<typeof useMediaPrivacyControl>;

function useMediaPrivacyControl() {
  const {
    mediaPrivacyMode,
    adultContentAcknowledged,
    updateMediaPrivacyMode,
  } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const changeMode = async (enabled: boolean, acknowledgeForTab = false) => {
    setPending(true);
    try {
      await updateMediaPrivacyMode(enabled, acknowledgeForTab);
      setConfirmOpen(false);
      toast.success(enabled ? "媒体隐私模式已开启" : "媒体隐私模式已关闭");
    } catch {
      toast.error(
        enabled
          ? "内容已保持隐藏，但隐私偏好未保存。"
          : "未能关闭隐私模式，内容仍保持隐藏。",
      );
    } finally {
      setPending(false);
    }
  };

  const requestToggle = () => {
    if (!mediaPrivacyMode) {
      void changeMode(true);
      return;
    }
    if (!adultContentAcknowledged) {
      setConfirmOpen(true);
      return;
    }
    void changeMode(false);
  };

  return {
    enabled: mediaPrivacyMode,
    confirmOpen,
    pending,
    requestToggle,
    setConfirmOpen,
    confirmDisable: () => changeMode(false, true),
  };
}

function DisablePrivacyDialog({ control }: { control: PrivacyControl }) {
  return (
    <Dialog open={control.confirmOpen} onOpenChange={control.setConfirmOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>关闭媒体隐私模式？</DialogTitle>
          <DialogDescription className="leading-6">
            关闭后将立即显示归档中的原始文字、图片和视频。继续表示你确认自己已年满 18 岁。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => control.setConfirmOpen(false)} disabled={control.pending}>
            取消
          </Button>
          <Button onClick={() => void control.confirmDisable()} disabled={control.pending}>
            {control.pending ? "正在确认..." : "我已年满 18 岁，关闭隐私模式"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
