import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "./ui/accordion";

const questions = [
  ["Does the browser change my local Codex?", "No. The playground stays in this browser; installing the CLI is a separate terminal action."],
  ["Can I run custom commands here?", "Custom commands work in the native editor. This browser playground does not execute them."],
  ["Where is my layout saved?", "In browser storage for this site, until you clear it. Download the JSON to keep a transferable copy."],
  ["Which versions are supported?", "See the maintained compatibility documentation on GitHub."],
  ["Is this an official OpenAI product?", "No. cxstatusline is an independent project."],
] as const;

export default function Faq() {
  return (
    <section id="faq" className="marketing-section content-section grid grid-cols-[minmax(0,40rem)] justify-center" aria-labelledby="faq-title">
      <div className="mb-8 text-center"><h2 id="faq-title" className="text-[clamp(2rem,3vw,3rem)]!">Before you install.</h2></div>
      <Accordion className="w-full">
        {questions.map(([question, answer], index) => (
          <AccordionItem value={`item-${index + 1}`} key={question}>
            <AccordionTrigger className="py-5 text-lg md:text-xl">{question}</AccordionTrigger>
            <AccordionPanel className="text-base md:text-lg">
              {index === 3 ? <a href="https://github.com/adrijshikhar/cxstatusline#requirements">{answer}</a> : answer}
            </AccordionPanel>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
