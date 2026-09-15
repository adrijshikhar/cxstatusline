import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "./ui/accordion";

export default function InstallDetails() {
  return (
    <>
      <Accordion>
        <AccordionItem value="restore">
          <AccordionTrigger>Restore the stock Codex launcher</AccordionTrigger>
          <AccordionPanel>To uninstall the patch, close Codex sessions and run <code>cxstatusline revert</code> to restore the stock launcher.</AccordionPanel>
        </AccordionItem>
      </Accordion>
      <p className="my-6">Browser save affects only this browser. Downloading <code>cxstatusline-settings.json</code> does not modify the local CLI.</p>
      <Accordion>
        <AccordionItem value="import">
          <AccordionTrigger>Optional: import a layout from the playground</AccordionTrigger>
          <AccordionPanel>In the native editor, choose <strong>Export</strong> to save a backup if you want to keep the current layout. Choose <strong>Import</strong>, enter the downloaded JSON path in <strong>Import Config</strong>, and press Enter. Inspect <strong>Import Preview</strong>, then choose <strong>Yes</strong> at “Apply this preset?”. Confirmation immediately saves and replaces native settings. Choose No or Escape to cancel without applying it.</AccordionPanel>
        </AccordionItem>
      </Accordion>
    </>
  );
}
