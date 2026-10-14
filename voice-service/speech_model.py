"""Compatibility loader for the pinned Chatterbox 0.1.7 tokenizer.

Upstream MTLTokenizer eagerly downloads/initializes a Chinese-only converter,
even for English/Hindi. Defer that converter until it is actually called. This
also avoids its Windows nested-cache path bug. English/Hindi tokenization and
Chatterbox inference are unchanged; no installed package files are modified.
"""


class DeferredConverter:
    def __init__(self, factory, model_dir=None):
        self.factory = factory
        self.model_dir = model_dir
        self.instance = None

    def __call__(self, text):
        if self.instance is None:
            self.instance = self.factory(self.model_dir)
        return self.instance(text)


def load_speech_model(device):
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    from chatterbox.models.tokenizers import tokenizer

    # Startup happens once, before any inference is accepted. Restore the factory
    # even if loading fails; the tokenizer instance retains its deferred wrapper.
    eager_converter = tokenizer.ChineseCangjieConverter
    tokenizer.ChineseCangjieConverter = lambda model_dir=None: DeferredConverter(eager_converter, model_dir)
    try:
        return ChatterboxMultilingualTTS.from_pretrained(device=device)
    finally:
        tokenizer.ChineseCangjieConverter = eager_converter
