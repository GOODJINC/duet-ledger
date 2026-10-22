package webassets

import "embed"

// Files contains the production web application. Run npm run build in web first.
//
//go:embed dist
var Files embed.FS
