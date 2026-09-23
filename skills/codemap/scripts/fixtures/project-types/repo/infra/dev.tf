locals {
  environment = "development"
  gateway_route = { path = "/items", upstream = "catalog", protocol = "HTTP" }
}
