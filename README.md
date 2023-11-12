# openai-gpt-assistants

![NPM](https://img.shields.io/npm/l/openai-gpt-assistants)
[![NPM](https://img.shields.io/npm/v/openai-gpt-assistants)](https://www.npmjs.com/package/openai-gpt-assistants)

Stateful, event-driven wrapper library around OpenAI's GPT Assistant API.

❗ **This library is in alpha and OpenAI's API is in beta, so expect potential bugs and breaking changes.**

Basic example which creates an assistant and gets a reply to a message:

```ts
import OpenAI from 'openai';
import { Context, Assistant, Thread, Message, Run } from 'openai-gpt-assistants';

// Setup OpenAI client and context
const openai = new OpenAI({ ... });
const ctx = new Context(openai);

// Create an assistant
assistant = await Assistant.create(ctx, {
  model: 'gpt-4-1106-preview',
  instructions: "Reply to everything like a pirate."
});
// Start a chat
const run = await Thread.createAndRun(ctx, {
  assistant,
  thread: {
    messages: [{
      role: "user",
      content: "Hello :)"
    }]
  }
});
await run.waitUntilFinished();
console.log("Thread:", run.thread);
// Display a response
const messages = await run.thread.messages();
console.log("Response:", messages.data[0]?.content);
```

## Getting Started

```
yarn install openai openai-gpt-assistants
```

## Recipes

### Continuing the chat with follow-ups

```ts
const [msg, run] = await thread.createMessageAndRun({
  role: "user",
  content: "What is my favorite color?"
}, { assistant });
await run.waitUntilFinished();
const messages = await thread.messages();
const [gptResponse, userMessage] = messages.data;
console.log("Response:", gptResponse.content);
```

### Loading existing resources by ID

Must call `.load()` after initialization.

```ts
const ctx = new Context(openaiClient);
const assistant = new Assistant(ctx, "<assistant id>");
await assistant.load();

const thread = new Thread(ctx, "<thread id>");
await thread.load();

const message = new Message(ctx, thread, "<message id>");
await message.load();

const run = new Run(ctx, thread, "<run id>");
await run.load();
```

### Creating a Thread & Run manually

```ts
const thread = await Thread.create(ctx, {
  messages: [{
    role: "user",
    content: "Hello :)"
  }]
});
const run = await thread.run(assistant);
const messages = await thread.messages();
```

Alternatively to `thread.run()`, you could do:
```ts
const run = await Run.create(ctx, thread, { assistant });
await run.waitUntilFinished();
```

### Access underlying OpenAI library objects

```ts
console.log(assistant.wrappedValue);
console.log(thread.wrappedValue);
console.log(message.wrappedValue);
console.log(run.wrappedValue);
```

## Function calling

First, define the function. This was copied from the OpenAI developer documentation for function calling [here](https://platform.openai.com/docs/guides/function-calling).

```ts
// Example dummy function hard coded to return the same weather
// In production, this could be your backend API or an external API
function getCurrentWeather(location: string, unit = "fahrenheit") {
  if (location.toLowerCase().includes("tokyo")) {
    return JSON.stringify({ location: "Tokyo", temperature: "10", unit: "celsius" });
  } else if (location.toLowerCase().includes("san francisco")) {
    return JSON.stringify({ location: "San Francisco", temperature: "72", unit: "fahrenheit" });
  } else if (location.toLowerCase().includes("paris")) {
    return JSON.stringify({ location: "Paris", temperature: "22", unit: "fahrenheit" });
  } else {
    return JSON.stringify({ location, temperature: "unknown" });
  }
}

const tools = [
  {
    type: "function",
    function: {
      name: "get_current_weather",
      description: "Get the current weather in a given location",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "The city and state, e.g. San Francisco, CA",
          },
          unit: { type: "string", enum: ["celsius", "fahrenheit"] },
        },
        required: ["location"],
      },
    },
  },
] satisfies OpenAI.Beta.Assistants.AssistantCreateParams['tools'];
```

Then, pass `tools` to the Assistant upon creation and prompt the assistant to use the function:

```ts
const assistant = await Assistant.create(ctx, {
  model: 'gpt-4-1106-preview',
  tools
});

const run = await Thread.createAndRun(ctx, {
  assistant,
  thread: {
    messages: [{
      role: "user",
      content: "Give me the weather in Tokyo using Celsius"
    }]
  }
});
```

The Run status will eventually change to `requires_action`. In this case, it means the assistant is waiting for the text output from your function. The Run won't finish until you submit these outputs.

You can respond to this using the built in event listener on the Run object:

```ts
run.on("actionRequired", async (action) => {
  if (!action || action?.type !== "submit_tool_outputs") return;
  const toolOutputs: OpenAI.Beta.Threads.Runs.RunSubmitToolOutputsParams.ToolOutput[] = [];
  // For each function call, execute the function and submit the result.
  // In our case, we know we only have 1 function type.
  for(const call of action.submit_tool_outputs.tool_calls) {
    if (call.function.name === "get_current_weather") {
      const { location, unit } = JSON.parse(call.function.arguments);
      const result = getCurrentWeather(location, unit);
      toolOutputs.push({
        tool_call_id: call.id,
        output: result
      })
    }
  }
  await run.submitToolOutputs({
    tool_outputs: toolOutputs
  });
})
```

Finally, you can wait for the Run to finish and get the response:

```ts
await run.waitUntilFinished();
const messages = await run.thread.messages();
console.log("Response:", messages.data[0]?.content);
```

## Listening for events

Each wrapped object - `Assistant`, `Thread`, `Run`, `Message` - is an EventEmitter.

```ts
assistant.on("updated", () => {
  console.log("Assistant updated!");
})
```

They have the following events:

- `created` - when the resource is created via the API
- `deleted` - when the resource is deleted via the API
- `updated` - when the **local cache** of the resource is updated.
- `cacheInserted` - when the resource is inserted into the local cache
- `cacheRemoved` - when the resource is removed from the local cache
- `fetched` - when the resource is fetched from the API

Note that the lib isn't notified when resources change on OpenAI's backend.

### Cache Events

There are also event emitters on the Context's cache. 

One event emitter for all events across all objects:

```ts
const ctx = new Context(openaiClient);
ctx.cache.emitter().on("updated", (objectType, id, value) => {
  // objectType: "assistant" | "thread" | "message" | "run"
  console.log("Cache updated:", objectType, id, value);
})
```

This could be useful for logging or to replicate the cache to some other storage backend or data structure.

You can also listen to events for a specific object type:

```ts
const ctx = new Context(openaiClient);
ctx.cache.emitter("message").on("cacheInserted", (id, value) => {
  // objectType: "assistant" | "thread" | "message" | "run"
  console.log("New chat message:", id, value);
})
```

Finally, you can listen to events for a specific object ID. This object ID must already exist in the cache or this will throw an error:

```ts
const ctx = new Context(openaiClient);
ctx.cache.emitter("message", "<message id>").on("updated", (id, value) => {
  // objectType: "assistant" | "thread" | "message" | "run"
  console.log("Chat message updated:", id, value);
})
```

### `Run` events

`Run` objects have a few more event types. These are all produced by polling OpenAI's API:
- statusChanged
  - `run.on("statusChanged", (status) => { ... })`
- actionRequired 
  - `run.on("actionRequired", (action) => { ... })`
- finished - run is finished, either successfully or with an error
  - `run.on("finished", (err, status) => { ... })`
