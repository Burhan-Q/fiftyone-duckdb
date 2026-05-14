"""fo-duckdb — FiftyOne plugin entry point.

JS-only panel that uses two Python operators to fetch dataset payload
and dispatch chart-to-view selection. The panel itself lives in
``src/`` and registers via ``PluginComponentType.Panel``.
"""


def register(p):
    # Operators added in subsequent tasks: load_dataset_payload, select_samples.
    pass
