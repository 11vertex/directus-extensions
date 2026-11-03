import { defineModule } from "@directus/extensions-sdk";
import ModuleComponent from "./module.vue";

export default defineModule({
  id: "media-usage-analyzer",
  name: "Media Usage Analyzer",
  icon: "perm_media",
  routes: [{ path: "", component: ModuleComponent }],
  preRegisterCheck(user) {
    return user?.admin_access === true;
  }
});
