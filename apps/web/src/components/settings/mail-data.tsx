import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImportMailDialog } from "@/components/mail-transfer";
import { Button } from "@/components/ui/button";
import { authQuery } from "@/lib/data";
export function MailDataSettings() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery(authQuery);
  return (
    <div className="max-w-xl space-y-8">
      <section>
        <h3 className="text-sm font-semibold">Import mail</h3>
        <p className="my-3 text-sm leading-relaxed text-muted-foreground">
          Import EML or MBOX files into {data?.account}. Attachments are preserved. Each file can contain up to 500
          messages and be up to 25 MB.
        </p>
        <Button size="sm" onClick={() => setOpen(true)}>
          Import mail
        </Button>
      </section>
      <section className="border-t pt-6">
        <h3 className="text-sm font-semibold">Export mail</h3>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Open a message's menu to export an EML file. Use the conversation menu or select conversations and choose
          Export to download an MBOX file. Exports include attachments, with a limit of 500 messages and 25 MB.
        </p>
      </section>
      <ImportMailDialog open={open} onOpenChange={setOpen} account={data?.account ?? ""} />
    </div>
  );
}
