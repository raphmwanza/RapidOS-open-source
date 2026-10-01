import Link from 'next/link';
import { pageMetadata } from '@/lib/marketing/metadata';
import Screenshot from '@/components/marketing/Screenshot';
import CodeBlock from '@/components/marketing/CodeBlock';
import { C, Callout, DocTitle, H2, H3, NextLink, OL, P, Table, UL } from '@/components/marketing/Prose';

export const metadata = pageMetadata({
  title: 'AI providers',
  description: 'Choose the language model behind your RapidOS WhatsApp assistant: Google Gemini, OpenAI, DeepSeek, Qwen or a self-hosted OpenAI-compatible model such as Ollama.',
  path: '/docs/ai-providers',
});

const a = 'font-medium text-emerald-700 hover:underline';

export default function AiProvidersDocs() {
  return (
    <>
      <DocTitle
        title="AI providers"
        lead="Each company chooses its own language model in Settings. The assistant uses it to understand customer messages, ask the right questions and extract claim details."
      />

      <H2 id="supported">Supported providers</H2>
      <Table
        head={['Provider value', 'Service', 'Base URL', 'Default / example model', 'API key']}
        rows={[
          [<C key="g">gemini</C>, 'Google Gemini (Google AI Studio)', <C key="gu">https://generativelanguage.googleapis.com/v1beta</C>, <><C>gemini-2.5-flash</C> (default)</>, 'Required'],
          [<C key="o">openai</C>, 'OpenAI', <C key="ou">https://api.openai.com/v1</C>, <><C>gpt-4o-mini</C> (default)</>, 'Required'],
          [<C key="d">deepseek</C>, 'DeepSeek', <C key="du">https://api.deepseek.com/v1</C>, <><C>deepseek-chat</C> (default)</>, 'Required'],
          [<C key="q">qwen</C>, 'Alibaba Cloud Model Studio (DashScope)', <C key="qu">https://dashscope.aliyuncs.com/compatible-mode/v1</C>, <><C>qwen-plus</C> (default)</>, 'Required'],
          [<C key="c">openai-compatible</C>, 'Any OpenAI-compatible server: Ollama, vLLM, LM Studio, OpenRouter…', 'Required, e.g. Ollama: http://host.docker.internal:11434/v1', <>e.g. <C>llama3.1:8b</C>, <C>qwen2.5:14b</C></>, 'Optional'],
        ]}
      />
      <P>
        Leave <strong>Model</strong> empty to use the default. The base URL can only be changed for <C>deepseek</C>, <C>qwen</C> and <C>openai-compatible</C>
        (for example to use the international DashScope endpoint <C>https://dashscope-intl.aliyuncs.com/compatible-mode/v1</C>); Gemini and OpenAI always use the
        official endpoints.
      </P>

      <H2 id="configure">Configure your provider</H2>
      <OL>
        <li>Create an API key with your provider (for Gemini: <a className={a} href="https://aistudio.google.com/apikey" rel="noopener noreferrer" target="_blank">Google AI Studio</a>).</li>
        <li>In RapidOS, open <strong>Settings</strong> and find the <strong>AI provider</strong> card (admins only).</li>
        <li>Choose the <strong>Provider</strong>, type the <strong>Model</strong> (optional), the <strong>Base URL</strong> when the field is shown, and paste the <strong>API key</strong>.</li>
        <li>Click <strong>Save</strong>. The key is encrypted and only its last four characters are shown afterwards. Leave the field blank later to keep it.</li>
        <li>Click <strong>Test bot</strong>.</li>
      </OL>
      <Screenshot id="settingsAi" caption="The AI provider card. The API key is never displayed after saving." />
      <P>Changes apply to the next customer message; there is nothing to restart.</P>

      <H2 id="test-bot">Test bot</H2>
      <P>
        <strong>Test bot</strong> sends a sample claim description to the saved provider and shows the fields it extracted, such as the insured&apos;s name and the
        incident date. If it fails, the message tells you why, for example an invalid key, an unknown model, an exhausted quota or a base URL that cannot be reached.
        Always save before testing: the test uses the saved settings, not the values typed in the form.
      </P>
      <P>
        API users can run the same test with <Link className={a} href="/docs/api#post-api-integration-settings-test">POST /api/integration-settings/test</Link>.
      </P>

      <H2 id="ollama">Self-hosted models with Ollama</H2>
      <P>Run the model on the same machine as Docker, or on any server the containers can reach:</P>
      <CodeBlock label="bash" code={'ollama pull qwen2.5:14b\n# keep the model loaded between customers\nOLLAMA_KEEP_ALIVE=24h ollama serve'} />
      <UL>
        <li>Provider: <C>openai-compatible</C></li>
        <li>Base URL: <C>http://host.docker.internal:11434/v1</C> (the address of the host machine from inside the containers)</li>
        <li>Model: the name you pulled, e.g. <C>qwen2.5:14b</C></li>
        <li>API key: leave empty (Ollama ignores it)</li>
      </UL>
      <Callout kind="tip" title="Speed and quality">
        Ollama unloads an idle model after 5 minutes, so the next customer waits for a cold start (10–30 seconds for 7–14B models). Set <C>OLLAMA_KEEP_ALIVE</C> to
        keep it in memory. Small models (under 7B) often miss claim details; 14B and larger work much better. Each request may take up to <C>LLM_TIMEOUT</C>{' '}
        seconds (default 90), which self-hosters can raise for slow hardware.
      </Callout>

      <H2 id="choosing">Choosing a model</H2>
      <UL>
        <li><strong>Fast and inexpensive:</strong> <C>gemini-2.5-flash</C>, <C>gpt-4o-mini</C>, <C>deepseek-chat</C> or <C>qwen-plus</C> handle claim conversations well in English, French and most supported languages.</li>
        <li><strong>Data stays on your servers:</strong> a self-hosted model with Ollama or vLLM. Nothing leaves your network except WhatsApp traffic.</li>
        <li><strong>Less common languages</strong> (Lingala, Yoruba, Hausa, Amharic): test with real conversations first; larger hosted models usually do better.</li>
      </UL>

      <H3>Server-wide fallback</H3>
      <P>
        A company that saved no AI settings uses the server variables <C>LLM_PROVIDER</C>, <C>LLM_API_KEY</C>, <C>LLM_MODEL</C> and <C>LLM_BASE_URL</C>, if set.
        See <Link className={a} href="/docs/self-hosting#environment">Self-hosting</Link>.
      </P>

      <NextLink href="/docs/dashboard" title="Using the dashboard" />
    </>
  );
}
