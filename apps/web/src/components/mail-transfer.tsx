import { useState } from "react";
import { Download, Upload } from "lucide-react";
import type { MailExportRequest } from "@mailfast/shared";
import { api, getActiveAccountId } from "@/lib/api";
import { queryClient, labelsCollection } from "@/lib/data";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ExportMailItem({ selection }: { selection: MailExportRequest }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <DropdownMenuItem
        disabled={busy}
        onSelect={(event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          void api
            .exportMail(selection)
            .catch((error: unknown) => {
              setError(error instanceof Error ? error.message : "Export failed. Try again.");
            })
            .finally(() => setBusy(false));
        }}
      >
        <Download />
        {busy ? "Preparing export…" : `Export ${"messageId" in selection ? "message (.eml)" : "conversations (.mbox)"}`}
      </DropdownMenuItem>
      {error && (
        <p role="alert" className="max-w-60 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

export function ImportMailDialog({
  open,
  onOpenChange,
  account,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: string;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  async function importFiles() {
    const accountId = getActiveAccountId();
    setBusy(true);
    setError("");
    let imported = 0;
    const errors: string[] = [];
    for (const [index, file] of files.entries()) {
      setStatus(`Importing file ${index + 1} of ${files.length}: ${file.name}`);
      try {
        const result = await api.importMail(file, accountId);
        imported += result.imported;
        for (const failure of result.failed) errors.push(`${file.name}, message ${failure.index}: ${failure.error}`);
      } catch (error) {
        errors.push(`${file.name}: ${error instanceof Error ? error.message : "Import failed"}`);
      }
    }
    setStatus(`Imported ${imported} message${imported === 1 ? "" : "s"} into ${account}.`);
    setError(errors.join("\n"));
    // Clear the submitted files so retrying cannot re-import successful messages.
    setFiles([]);
    setBusy(false);
    void queryClient.invalidateQueries({ queryKey: ["threads", accountId] });
    void queryClient.invalidateQueries({ queryKey: ["search", accountId] });
    void labelsCollection.utils.refetch();
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Import mail</DialogTitle>
          <DialogDescription>
            Add .eml or .mbox files to {account}. Attachments are included. Up to 25 MB and 500 messages per file.
            Importing a file again may create duplicates.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-2 text-sm">
          Mail files
          <Input
            type="file"
            accept=".eml,.mbox"
            multiple
            disabled={busy}
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []);
              setStatus("");
              const invalid = selected.some(
                (file) => !/\.(eml|mbox)$/i.test(file.name) || !file.size || file.size > 25 * 1024 * 1024,
              );
              setError(invalid ? "Choose nonempty .eml or .mbox files up to 25 MB each." : "");
              setFiles(invalid ? [] : selected);
            }}
          />
        </label>
        <p role="status" className="wrap-break-word text-sm text-muted-foreground">
          {status}
        </p>
        {error && (
          <p
            role="alert"
            className="max-h-40 overflow-auto whitespace-pre-wrap wrap-break-word text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <Button disabled={busy || !files.length} onClick={() => void importFiles()}>
          <Upload />
          {busy ? "Importing…" : "Import mail"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
