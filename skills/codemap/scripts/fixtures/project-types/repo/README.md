# Arena and catalog

Arena is an independently run simulation. Each tick reads player input, updates
position components through a movement system, then publishes the world and
starts the next tick. Entity IDs select position data; the movement system writes
those positions. The tick interval is 50 ms.

Catalog is an independently usable HTTP API. GET /items enters the router,
passes authentication, and reaches the item handler. Authentication can reject
the request instead. The handler returns the catalog response.

The development deployment declares a gateway forwarding HTTP to the API.
These declarations describe a development environment, not observed deployment.
