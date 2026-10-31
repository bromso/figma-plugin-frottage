// Preload 1 of 2. Must run before anything imports @testing-library/*,
// otherwise `screen` queries throw because `document` does not exist yet.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
