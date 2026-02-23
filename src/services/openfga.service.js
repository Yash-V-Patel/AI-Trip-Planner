const { OpenFgaClient } = require("@openfga/sdk");

class OpenFGAService {
  constructor() {
    this.client = null;
    this.storeId = null;
    this.modelId = null;
    this.initialized = false;
    this.initializing = false;
  }

  /**
   * Check if OpenFGA service is available and initialized
   */
  async isAvailable() {
    try {
      if (!this.initialized) {
        return false;
      }
      await this.client.readAuthorizationModels();
      return true;
    } catch (error) {
      console.error("OpenFGA availability check failed:", error.message);
      return false;
    }
  }

  async initialize() {
    if (this.initialized) return true;
    if (this.initializing) {
      while (this.initializing) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return this.initialized;
    }

    this.initializing = true;

    try {
      const apiUrl = process.env.OPENFGA_API_URL || "http://localhost:8080";

      const fgaClient = new OpenFgaClient({ apiUrl });

      console.log("Checking for existing OpenFGA stores...");
      const stores = await fgaClient.listStores();
      let store = stores.stores.find((s) => s.name === "AI-trip-planner");

      if (!store) {
        console.log("Creating new OpenFGA store...");
        store = await fgaClient.createStore({ name: "AI-trip-planner" });
      } else {
        console.log("Found existing OpenFGA store");
      }

      this.storeId = store.id;
      console.log(`✓ OpenFGA Store ID: ${this.storeId}`);

      this.client = new OpenFgaClient({ apiUrl, storeId: this.storeId });

      console.log("Checking for existing authorization models...");
      const models = await this.client.readAuthorizationModels();

      if (models.authorization_models.length > 0) {
        this.modelId = models.authorization_models[0].id;
        console.log(`✓ Using existing authorization model: ${this.modelId}`);
      } else {
        console.log("Creating new authorization model...");

        const model = await this.client.writeAuthorizationModel({
          schema_version: "1.1",
          type_definitions: [
            { type: "user" },
            {
              type: "superadmin",
              relations: { can_manage_all: { this: {} } },
              metadata: {
                relations: {
                  can_manage_all: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "vendor",
              relations: {
                is_vendor: { this: {} },
                can_sell_accommodations: { this: {} },
                can_sell_transportation: { this: {} },
                can_sell_packages: { this: {} },
                can_sell_experiences: { this: {} },
                can_sell_shopping: { this: {} },
                can_manage_team: { this: {} },
                can_view_financials: { this: {} },
                can_request_payout: { this: {} },
                superadmin_access: { this: {} },
              },
              metadata: {
                relations: {
                  is_vendor: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                  can_sell_accommodations: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                  can_sell_transportation: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                  can_sell_packages: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                  can_sell_experiences: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                  can_sell_shopping: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                  can_manage_team: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                  can_view_financials: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                  can_request_payout: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "vendor_profile",
              relations: {
                owner: { this: {} },
                team_member: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "team_member" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_manage_documents: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_manage_team_members: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: {
                    directly_related_user_types: [
                      { type: "user" },
                      { type: "vendor#is_vendor" },
                    ],
                  },
                  team_member: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "profile",
              relations: {
                owner: { this: {} },
                can_view: {
                  union: {
                    child: [{ computedUserset: { relation: "owner" } }],
                  },
                },
                can_edit: {
                  union: {
                    child: [{ computedUserset: { relation: "owner" } }],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                },
              },
            },
            {
              type: "travelplan",
              relations: {
                owner: { this: {} },
                viewer: { this: {} },
                editor: { this: {} },
                suggester: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "viewer" } },
                      { computedUserset: { relation: "editor" } },
                      { computedUserset: { relation: "suggester" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "editor" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_suggest: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "editor" } },
                      { computedUserset: { relation: "suggester" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_share: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  viewer: { directly_related_user_types: [{ type: "user" }] },
                  editor: { directly_related_user_types: [{ type: "user" }] },
                  suggester: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "accommodation",
              relations: {
                owner: { this: {} },
                manager: { this: {} },
                editor: { this: {} },
                viewer: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "editor" } },
                      { computedUserset: { relation: "viewer" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "editor" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_update: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_manage_rooms: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_manage_services: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: {
                    directly_related_user_types: [
                      { type: "user" },
                      { type: "vendor#can_sell_accommodations" },
                    ],
                  },
                  manager: { directly_related_user_types: [{ type: "user" }] },
                  editor: { directly_related_user_types: [{ type: "user" }] },
                  viewer: { directly_related_user_types: [{ type: "user" }] },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "accommodationroom",
              relations: {
                owner: { this: {} },
                parent_accommodation: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_accommodation" },
                          computedUserset: { relation: "viewer" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_accommodation" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_accommodation" },
                          computedUserset: { relation: "manager" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  parent_accommodation: {
                    directly_related_user_types: [{ type: "accommodation" }],
                  },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "accommodationservice",
              relations: {
                owner: { this: {} },
                parent_accommodation: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_accommodation" },
                          computedUserset: { relation: "viewer" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_accommodation" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_accommodation" },
                          computedUserset: { relation: "manager" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  parent_accommodation: {
                    directly_related_user_types: [{ type: "accommodation" }],
                  },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "accommodationbooking",
              relations: {
                owner: { this: {} },
                parent_travelplan: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "viewer" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "suggester" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "superadmin_access" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "superadmin_access" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_cancel: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "superadmin_access" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  parent_travelplan: {
                    directly_related_user_types: [{ type: "travelplan" }],
                  },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "transportationprovider",
              relations: {
                owner: { this: {} },
                manager: { this: {} },
                editor: { this: {} },
                viewer: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "editor" } },
                      { computedUserset: { relation: "viewer" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "editor" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_update: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_manage_vehicles: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: {
                    directly_related_user_types: [
                      { type: "user" },
                      { type: "vendor#can_sell_transportation" },
                    ],
                  },
                  manager: { directly_related_user_types: [{ type: "user" }] },
                  editor: { directly_related_user_types: [{ type: "user" }] },
                  viewer: { directly_related_user_types: [{ type: "user" }] },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "transportationvehicle",
              relations: {
                owner: { this: {} },
                parent_provider: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_provider" },
                          computedUserset: { relation: "viewer" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_provider" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_provider" },
                          computedUserset: { relation: "manager" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  parent_provider: {
                    directly_related_user_types: [
                      { type: "transportationprovider" },
                    ],
                  },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "transportationbooking",
              relations: {
                owner: { this: {} },
                parent_travelplan: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "viewer" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "suggester" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "superadmin_access" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "superadmin_access" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_cancel: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "superadmin_access" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  parent_travelplan: {
                    directly_related_user_types: [{ type: "travelplan" }],
                  },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "travelpackage",
              relations: {
                owner: { this: {} },
                manager: { this: {} },
                editor: { this: {} },
                viewer: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "editor" } },
                      { computedUserset: { relation: "viewer" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "editor" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_update: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: {
                    directly_related_user_types: [
                      { type: "user" },
                      { type: "vendor#can_sell_packages" },
                    ],
                  },
                  manager: { directly_related_user_types: [{ type: "user" }] },
                  editor: { directly_related_user_types: [{ type: "user" }] },
                  viewer: { directly_related_user_types: [{ type: "user" }] },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "travelpackagebooking",
              relations: {
                owner: { this: {} },
                parent_travelplan: { this: {} },
                parent_package: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "viewer" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "suggester" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_package" },
                          computedUserset: { relation: "viewer" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_package" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_package" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_cancel: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  parent_travelplan: {
                    directly_related_user_types: [{ type: "travelplan" }],
                  },
                  parent_package: {
                    directly_related_user_types: [{ type: "travelpackage" }],
                  },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "vendorexperience",
              relations: {
                owner: { this: {} },
                manager: { this: {} },
                editor: { this: {} },
                viewer: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "editor" } },
                      { computedUserset: { relation: "viewer" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "editor" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_update: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: {
                    directly_related_user_types: [
                      { type: "user" },
                      { type: "vendor#can_sell_experiences" },
                    ],
                  },
                  manager: { directly_related_user_types: [{ type: "user" }] },
                  editor: { directly_related_user_types: [{ type: "user" }] },
                  viewer: { directly_related_user_types: [{ type: "user" }] },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "experiencebooking",
              relations: {
                owner: { this: {} },
                parent_travelplan: { this: {} },
                parent_experience: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "viewer" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "suggester" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_experience" },
                          computedUserset: { relation: "viewer" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_experience" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_experience" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_cancel: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  parent_travelplan: {
                    directly_related_user_types: [{ type: "travelplan" }],
                  },
                  parent_experience: {
                    directly_related_user_types: [{ type: "vendorexperience" }],
                  },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "retailstore",
              relations: {
                owner: { this: {} },
                manager: { this: {} },
                editor: { this: {} },
                viewer: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "editor" } },
                      { computedUserset: { relation: "viewer" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "editor" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_update: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_manage_products: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "manager" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: {
                    directly_related_user_types: [
                      { type: "user" },
                      { type: "vendor#can_sell_shopping" },
                    ],
                  },
                  manager: { directly_related_user_types: [{ type: "user" }] },
                  editor: { directly_related_user_types: [{ type: "user" }] },
                  viewer: { directly_related_user_types: [{ type: "user" }] },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "shoppingvisit",
              relations: {
                owner: { this: {} },
                parent_travelplan: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "viewer" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "suggester" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "superadmin_access" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "superadmin_access" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_cancel: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "superadmin_access" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  parent_travelplan: {
                    directly_related_user_types: [{ type: "travelplan" }],
                  },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "travelexperience",
              relations: {
                owner: { this: {} },
                parent_travelplan: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "viewer" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "suggester" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "superadmin_access" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_edit: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "superadmin_access" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_cancel: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "editor" },
                        },
                      },
                      {
                        tupleToUserset: {
                          tupleset: { object: "parent_travelplan" },
                          computedUserset: { relation: "superadmin_access" },
                        },
                      },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: { directly_related_user_types: [{ type: "user" }] },
                  parent_travelplan: {
                    directly_related_user_types: [{ type: "travelplan" }],
                  },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "transaction",
              relations: {
                owner: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_refund: {
                  computedUserset: { relation: "superadmin_access" },
                },
              },
              metadata: {
                relations: {
                  owner: {
                    directly_related_user_types: [
                      { type: "user" },
                      { type: "vendor#is_vendor" },
                    ],
                  },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "payout",
              relations: {
                owner: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_process: {
                  computedUserset: { relation: "superadmin_access" },
                },
                can_cancel: {
                  union: {
                    child: [
                      { computedUserset: { relation: "owner" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  owner: {
                    directly_related_user_types: [
                      { type: "user" },
                      { type: "vendor#is_vendor" },
                    ],
                  },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "vendor_team_member",
              relations: {
                vendor: { this: {} },
                user: { this: {} },
                is_admin: { this: {} },
                is_manager: { this: {} },
                is_editor: { this: {} },
                is_viewer: { this: {} },
                can_manage_team: { computedUserset: { relation: "is_admin" } },
                can_manage_listings: {
                  union: {
                    child: [
                      { computedUserset: { relation: "is_admin" } },
                      { computedUserset: { relation: "is_manager" } },
                    ],
                  },
                },
                can_edit_listings: {
                  union: {
                    child: [
                      { computedUserset: { relation: "is_admin" } },
                      { computedUserset: { relation: "is_manager" } },
                      { computedUserset: { relation: "is_editor" } },
                    ],
                  },
                },
                can_view_listings: {
                  union: {
                    child: [
                      { computedUserset: { relation: "is_admin" } },
                      { computedUserset: { relation: "is_manager" } },
                      { computedUserset: { relation: "is_editor" } },
                      { computedUserset: { relation: "is_viewer" } },
                    ],
                  },
                },
              },
              metadata: {
                relations: {
                  vendor: { directly_related_user_types: [{ type: "vendor" }] },
                  user: { directly_related_user_types: [{ type: "user" }] },
                  is_admin: { directly_related_user_types: [{ type: "user" }] },
                  is_manager: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                  is_editor: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                  is_viewer: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
            {
              type: "vendor_review",
              relations: {
                author: { this: {} },
                vendor: { this: {} },
                superadmin_access: { this: {} },
                can_view: {
                  union: {
                    child: [
                      { computedUserset: { relation: "author" } },
                      { computedUserset: { relation: "vendor" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_respond: {
                  union: {
                    child: [
                      { computedUserset: { relation: "vendor" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_delete: {
                  union: {
                    child: [
                      { computedUserset: { relation: "author" } },
                      { computedUserset: { relation: "superadmin_access" } },
                    ],
                  },
                },
                can_hide: {
                  computedUserset: { relation: "superadmin_access" },
                },
              },
              metadata: {
                relations: {
                  author: { directly_related_user_types: [{ type: "user" }] },
                  vendor: { directly_related_user_types: [{ type: "vendor" }] },
                  superadmin_access: {
                    directly_related_user_types: [{ type: "user" }],
                  },
                },
              },
            },
          ],
        });

        this.modelId = model.authorization_model_id;
        console.log(`✓ Created new authorization model: ${this.modelId}`);
      }

      this.client = new OpenFgaClient({
        apiUrl,
        storeId: this.storeId,
        authorizationModelId: this.modelId,
      });

      this.initialized = true;
      console.log("✓ OpenFGA service fully initialized");

      process.env.OPENFGA_STORE_ID = this.storeId;
      process.env.OPENFGA_MODEL_ID = this.modelId;

      return true;
    } catch (error) {
      console.error("❌ OpenFGA initialization failed:", error.message);
      this.initialized = false;
      throw error;
    } finally {
      this.initializing = false;
    }
  }

  async ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.client;
  }

  // ==================== WRITE TUPLES ====================

  async writeTuples(tuples) {
    const client = await this.ensureInitialized();
    return client.writeTuples(tuples);
  }

  // ==================== DELETE TUPLES ====================

  async deleteTuples(tuples) {
    const client = await this.ensureInitialized();
    return client.deleteTuples(tuples);
  }

  // ==================== VENDOR RELATIONS ====================

  async assignVendorRole(userId, vendorId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: "is_vendor",
        object: `vendor:${vendorId}`,
      },
    ]);
  }

  async grantVendorPermission(userId, vendorId, permission) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: permission,
        object: `vendor:${vendorId}`,
      },
    ]);
  }

  async revokeVendorPermission(userId, vendorId, permission) {
    const client = await this.ensureInitialized();
    return client.deleteTuples([
      {
        user: `user:${userId}`,
        relation: permission,
        object: `vendor:${vendorId}`,
      },
    ]);
  }

  /**
   * Check if user is a vendor (has is_vendor relation on any vendor)
   */
  async isVendor(userId) {
    try {
      const client = await this.ensureInitialized();

      // List all vendors where this user has is_vendor relation
      const response = await client.listObjects({
        user: `user:${userId}`,
        relation: "is_vendor",
        type: "vendor",
      });

      console.log(`isVendor check for ${userId}:`, response.objects);
      return response.objects.length > 0;
    } catch (error) {
      console.error("Error in isVendor:", error);
      return false;
    }
  }
  // ==================== VENDOR PROFILE RELATIONS ====================

  async createVendorProfileRelations(userId, profileId, vendorId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: "owner",
        object: `vendor_profile:${profileId}`,
      },
    ]);
  }

  async addVendorTeamMember(profileId, memberId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${memberId}`,
        relation: "team_member",
        object: `vendor_profile:${profileId}`,
      },
    ]);
  }

  // ==================== SUPERADMIN RELATIONS ====================

  async assignSuperAdmin(userId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: "can_manage_all",
        object: "superadmin:global",
      },
    ]);
  }

  async removeSuperAdmin(userId) {
    const client = await this.ensureInitialized();
    return client.deleteTuples([
      {
        user: `user:${userId}`,
        relation: "can_manage_all",
        object: "superadmin:global",
      },
    ]);
  }

  // ==================== PROFILE RELATIONS ====================

  async createProfileRelations(userId, profileId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: "owner",
        object: `profile:${profileId}`,
      },
    ]);
  }

  // ==================== TRAVEL PLAN RELATIONS ====================

  async createTravelPlanRelations(userId, planId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: "owner",
        object: `travelplan:${planId}`,
      },
    ]);
  }

  async shareTravelPlan(planId, userId, permission) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: permission,
        object: `travelplan:${planId}`,
      },
    ]);
  }

  async revokeTravelPlanAccess(planId, userId, permission) {
    const client = await this.ensureInitialized();
    return client.deleteTuples([
      {
        user: `user:${userId}`,
        relation: permission,
        object: `travelplan:${planId}`,
      },
    ]);
  }

  async grantSuperadminAccess(planId, adminId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${adminId}`,
        relation: "superadmin_access",
        object: `travelplan:${planId}`,
      },
    ]);
  }

  // ==================== ACCOMMODATION RELATIONS ====================

  async createAccommodationRelations(userId, accommodationId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: "owner",
        object: `accommodation:${accommodationId}`,
      },
    ]);
  }

  async addAccommodationManager(accommodationId, managerId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${managerId}`,
        relation: "manager",
        object: `accommodation:${accommodationId}`,
      },
    ]);
  }

  async addAccommodationEditor(accommodationId, editorId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${editorId}`,
        relation: "editor",
        object: `accommodation:${accommodationId}`,
      },
    ]);
  }

  async addAccommodationViewer(accommodationId, viewerId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${viewerId}`,
        relation: "viewer",
        object: `accommodation:${accommodationId}`,
      },
    ]);
  }

  async removeAccommodationUser(accommodationId, userId, relation) {
    const client = await this.ensureInitialized();
    return client.deleteTuples([
      {
        user: `user:${userId}`,
        relation,
        object: `accommodation:${accommodationId}`,
      },
    ]);
  }

  // ==================== ROOM RELATIONS ====================

  async createRoomRelations(ownerId, roomId, accommodationId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${ownerId}`,
        relation: "owner",
        object: `accommodationroom:${roomId}`,
      },
      {
        user: `accommodation:${accommodationId}`,
        relation: "parent_accommodation",
        object: `accommodationroom:${roomId}`,
      },
    ]);
  }

  // ==================== SERVICE RELATIONS ====================

  async createServiceRelations(ownerId, serviceId, accommodationId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${ownerId}`,
        relation: "owner",
        object: `accommodationservice:${serviceId}`,
      },
      {
        user: `accommodation:${accommodationId}`,
        relation: "parent_accommodation",
        object: `accommodationservice:${serviceId}`,
      },
    ]);
  }

  // ==================== TRANSPORTATION PROVIDER RELATIONS ====================

  async createTransportationProviderRelations(userId, providerId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: "owner",
        object: `transportationprovider:${providerId}`,
      },
    ]);
  }

  async addTransportationProviderManager(providerId, managerId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${managerId}`,
        relation: "manager",
        object: `transportationprovider:${providerId}`,
      },
    ]);
  }

  async addTransportationProviderEditor(providerId, editorId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${editorId}`,
        relation: "editor",
        object: `transportationprovider:${providerId}`,
      },
    ]);
  }

  async addTransportationProviderViewer(providerId, viewerId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${viewerId}`,
        relation: "viewer",
        object: `transportationprovider:${providerId}`,
      },
    ]);
  }

  // ==================== VEHICLE RELATIONS ====================

  async createTransportationVehicleRelations(ownerId, vehicleId, providerId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${ownerId}`,
        relation: "owner",
        object: `transportationvehicle:${vehicleId}`,
      },
      {
        user: `transportationprovider:${providerId}`,
        relation: "parent_provider",
        object: `transportationvehicle:${vehicleId}`,
      },
    ]);
  }

  // ==================== TRAVEL PACKAGE RELATIONS ====================

  async createTravelPackageRelations(userId, packageId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: "owner",
        object: `travelpackage:${packageId}`,
      },
    ]);
  }

  async addTravelPackageManager(packageId, managerId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${managerId}`,
        relation: "manager",
        object: `travelpackage:${packageId}`,
      },
    ]);
  }

  // ==================== VENDOR EXPERIENCE RELATIONS ====================

  async createVendorExperienceRelations(userId, experienceId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: "owner",
        object: `vendorexperience:${experienceId}`,
      },
    ]);
  }

  async addVendorExperienceManager(experienceId, managerId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${managerId}`,
        relation: "manager",
        object: `vendorexperience:${experienceId}`,
      },
    ]);
  }

  // ==================== RETAIL STORE RELATIONS ====================

  async createRetailStoreRelations(userId, storeId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: "owner",
        object: `retailstore:${storeId}`,
      },
    ]);
  }

  async addRetailStoreManager(storeId, managerId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${managerId}`,
        relation: "manager",
        object: `retailstore:${storeId}`,
      },
    ]);
  }
  async canViewRetailStore(userId, storeId) {
    return this.checkPermission(userId, "can_view", `retailstore:${storeId}`);
  }

  async canEditRetailStore(userId, storeId) {
    return this.checkPermission(userId, "can_edit", `retailstore:${storeId}`);
  }

  async canUpdateRetailStore(userId, storeId) {
    return this.checkPermission(userId, "can_update", `retailstore:${storeId}`);
  }

  async canManageStoreProducts(userId, storeId) {
    return this.checkPermission(
      userId,
      "can_manage_products",
      `retailstore:${storeId}`,
    );
  }

  async canDeleteRetailStore(userId, storeId) {
    return this.checkPermission(userId, "can_delete", `retailstore:${storeId}`);
  }

  // ==================== BOOKING RELATIONS ====================

  async createAccommodationBookingRelations(userId, bookingId, planId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: "owner",
        object: `accommodationbooking:${bookingId}`,
      },
      {
        user: `travelplan:${planId}`,
        relation: "parent_travelplan",
        object: `accommodationbooking:${bookingId}`,
      },
    ]);
  }

  async createTransportationBookingRelations(userId, bookingId, planId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: "owner",
        object: `transportationbooking:${bookingId}`,
      },
      {
        user: `travelplan:${planId}`,
        relation: "parent_travelplan",
        object: `transportationbooking:${bookingId}`,
      },
    ]);
  }

  async createTravelPackageBookingRelations(
    userId,
    bookingId,
    planId,
    packageId,
  ) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: "owner",
        object: `travelpackagebooking:${bookingId}`,
      },
      {
        user: `travelplan:${planId}`,
        relation: "parent_travelplan",
        object: `travelpackagebooking:${bookingId}`,
      },
      {
        user: `travelpackage:${packageId}`,
        relation: "parent_package",
        object: `travelpackagebooking:${bookingId}`,
      },
    ]);
  }

  async createExperienceBookingRelations(
    userId,
    bookingId,
    planId,
    experienceId,
  ) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: "owner",
        object: `experiencebooking:${bookingId}`,
      },
      {
        user: `travelplan:${planId}`,
        relation: "parent_travelplan",
        object: `experiencebooking:${bookingId}`,
      },
      {
        user: `vendorexperience:${experienceId}`,
        relation: "parent_experience",
        object: `experiencebooking:${bookingId}`,
      },
    ]);
  }

  async createShoppingVisitRelations(userId, visitId, planId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: "owner",
        object: `shoppingvisit:${visitId}`,
      },
      {
        user: `travelplan:${planId}`,
        relation: "parent_travelplan",
        object: `shoppingvisit:${visitId}`,
      },
    ]);
  }

  async createTravelExperienceRelations(userId, experienceId, planId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: "owner",
        object: `travelexperience:${experienceId}`,
      },
      {
        user: `travelplan:${planId}`,
        relation: "parent_travelplan",
        object: `travelexperience:${experienceId}`,
      },
    ]);
  }

  // ==================== TEAM MEMBER RELATIONS ====================

  async createTeamMemberRelations(vendorId, userId, role, memberId) {
    const client = await this.ensureInitialized();
    const tuples = [
      {
        user: `user:${userId}`,
        relation: role,
        object: `vendor_team_member:${memberId}`,
      },
      {
        user: `vendor:${vendorId}`,
        relation: "vendor",
        object: `vendor_team_member:${memberId}`,
      },
      {
        user: `user:${userId}`,
        relation: "user",
        object: `vendor_team_member:${memberId}`,
      },
    ];
    return client.writeTuples(tuples);
  }

  async updateTeamMemberRole(memberId, userId, oldRole, newRole) {
    const client = await this.ensureInitialized();
    await client.deleteTuples([
      {
        user: `user:${userId}`,
        relation: oldRole,
        object: `vendor_team_member:${memberId}`,
      },
    ]);
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: newRole,
        object: `vendor_team_member:${memberId}`,
      },
    ]);
  }

  // ==================== REVIEW RELATIONS ====================

  async createVendorReviewRelations(userId, reviewId, vendorId) {
    const client = await this.ensureInitialized();
    return client.writeTuples([
      {
        user: `user:${userId}`,
        relation: "author",
        object: `vendor_review:${reviewId}`,
      },
      {
        user: `vendor:${vendorId}`,
        relation: "vendor",
        object: `vendor_review:${reviewId}`,
      },
    ]);
  }

  // ==================== PERMISSION CHECKS ====================

  async checkPermission(userId, relation, object) {
    try {
      const client = await this.ensureInitialized();
      const response = await client.check({
        user: `user:${userId}`,
        relation,
        object,
      });
      return response.allowed;
    } catch (error) {
      console.error("OpenFGA check error:", error);
      return false;
    }
  }

  async checkSuperAdmin(userId) {
    return this.checkPermission(userId, "can_manage_all", "superadmin:global");
  }

  // ==================== TRAVEL PLAN PERMISSION CHECKS ====================

  async canViewTravelPlan(userId, planId) {
    return this.checkPermission(userId, "can_view", `travelplan:${planId}`);
  }

  async canEditTravelPlan(userId, planId) {
    return this.checkPermission(userId, "can_edit", `travelplan:${planId}`);
  }

  async canSuggestTravelPlan(userId, planId) {
    return this.checkPermission(userId, "can_suggest", `travelplan:${planId}`);
  }

  async canDeleteTravelPlan(userId, planId) {
    return this.checkPermission(userId, "can_delete", `travelplan:${planId}`);
  }

  async canShareTravelPlan(userId, planId) {
    return this.checkPermission(userId, "can_share", `travelplan:${planId}`);
  }

  // ==================== ACCOMMODATION PERMISSION CHECKS ====================

  async canViewAccommodation(userId, accommodationId) {
    return this.checkPermission(
      userId,
      "can_view",
      `accommodation:${accommodationId}`,
    );
  }

  async canEditAccommodation(userId, accommodationId) {
    return this.checkPermission(
      userId,
      "can_edit",
      `accommodation:${accommodationId}`,
    );
  }

  async canUpdateAccommodation(userId, accommodationId) {
    return this.checkPermission(
      userId,
      "can_update",
      `accommodation:${accommodationId}`,
    );
  }

  async canManageAccommodationRooms(userId, accommodationId) {
    return this.checkPermission(
      userId,
      "can_manage_rooms",
      `accommodation:${accommodationId}`,
    );
  }

  async canManageAccommodationServices(userId, accommodationId) {
    return this.checkPermission(
      userId,
      "can_manage_services",
      `accommodation:${accommodationId}`,
    );
  }

  async canDeleteAccommodation(userId, accommodationId) {
    return this.checkPermission(
      userId,
      "can_delete",
      `accommodation:${accommodationId}`,
    );
  }

  // ==================== ROOM PERMISSION CHECKS ====================

  async canViewRoom(userId, roomId) {
    return this.checkPermission(
      userId,
      "can_view",
      `accommodationroom:${roomId}`,
    );
  }

  async canEditRoom(userId, roomId) {
    return this.checkPermission(
      userId,
      "can_edit",
      `accommodationroom:${roomId}`,
    );
  }

  async canDeleteRoom(userId, roomId) {
    return this.checkPermission(
      userId,
      "can_delete",
      `accommodationroom:${roomId}`,
    );
  }

  // ==================== SERVICE PERMISSION CHECKS ====================

  async canViewService(userId, serviceId) {
    return this.checkPermission(
      userId,
      "can_view",
      `accommodationservice:${serviceId}`,
    );
  }

  async canEditService(userId, serviceId) {
    return this.checkPermission(
      userId,
      "can_edit",
      `accommodationservice:${serviceId}`,
    );
  }

  async canDeleteService(userId, serviceId) {
    return this.checkPermission(
      userId,
      "can_delete",
      `accommodationservice:${serviceId}`,
    );
  }

  // ==================== TRANSPORTATION PROVIDER PERMISSION CHECKS ====================

  async canViewTransportationProvider(userId, providerId) {
    return this.checkPermission(
      userId,
      "can_view",
      `transportationprovider:${providerId}`,
    );
  }

  async canEditTransportationProvider(userId, providerId) {
    return this.checkPermission(
      userId,
      "can_edit",
      `transportationprovider:${providerId}`,
    );
  }

  async canUpdateTransportationProvider(userId, providerId) {
    return this.checkPermission(
      userId,
      "can_update",
      `transportationprovider:${providerId}`,
    );
  }

  async canDeleteTransportationProvider(userId, providerId) {
    return this.checkPermission(
      userId,
      "can_delete",
      `transportationprovider:${providerId}`,
    );
  }

  async canManageProviderVehicles(userId, providerId) {
    return this.checkPermission(
      userId,
      "can_manage_vehicles",
      `transportationprovider:${providerId}`,
    );
  }

  // ==================== VEHICLE PERMISSION CHECKS ====================

  async canViewTransportationVehicle(userId, vehicleId) {
    return this.checkPermission(
      userId,
      "can_view",
      `transportationvehicle:${vehicleId}`,
    );
  }

  async canEditTransportationVehicle(userId, vehicleId) {
    return this.checkPermission(
      userId,
      "can_edit",
      `transportationvehicle:${vehicleId}`,
    );
  }

  async canDeleteTransportationVehicle(userId, vehicleId) {
    return this.checkPermission(
      userId,
      "can_delete",
      `transportationvehicle:${vehicleId}`,
    );
  }

  // ==================== TRAVEL PACKAGE PERMISSION CHECKS ====================

  async canViewTravelPackage(userId, packageId) {
    return this.checkPermission(
      userId,
      "can_view",
      `travelpackage:${packageId}`,
    );
  }

  async canEditTravelPackage(userId, packageId) {
    return this.checkPermission(
      userId,
      "can_edit",
      `travelpackage:${packageId}`,
    );
  }

  async canUpdateTravelPackage(userId, packageId) {
    return this.checkPermission(
      userId,
      "can_update",
      `travelpackage:${packageId}`,
    );
  }

  async canDeleteTravelPackage(userId, packageId) {
    return this.checkPermission(
      userId,
      "can_delete",
      `travelpackage:${packageId}`,
    );
  }

  // ==================== VENDOR EXPERIENCE PERMISSION CHECKS ====================

  async canViewVendorExperience(userId, experienceId) {
    return this.checkPermission(
      userId,
      "can_view",
      `vendorexperience:${experienceId}`,
    );
  }

  async canEditVendorExperience(userId, experienceId) {
    return this.checkPermission(
      userId,
      "can_edit",
      `vendorexperience:${experienceId}`,
    );
  }

  async canUpdateVendorExperience(userId, experienceId) {
    return this.checkPermission(
      userId,
      "can_update",
      `vendorexperience:${experienceId}`,
    );
  }

  async canDeleteVendorExperience(userId, experienceId) {
    return this.checkPermission(
      userId,
      "can_delete",
      `vendorexperience:${experienceId}`,
    );
  }

  // ==================== RETAIL STORE PERMISSION CHECKS ====================

  async canViewRetailStore(userId, storeId) {
    return this.checkPermission(userId, "can_view", `retailstore:${storeId}`);
  }

  async canEditRetailStore(userId, storeId) {
    return this.checkPermission(userId, "can_edit", `retailstore:${storeId}`);
  }

  async canUpdateRetailStore(userId, storeId) {
    return this.checkPermission(userId, "can_update", `retailstore:${storeId}`);
  }

  async canManageStoreProducts(userId, storeId) {
    return this.checkPermission(
      userId,
      "can_manage_products",
      `retailstore:${storeId}`,
    );
  }

  async canDeleteRetailStore(userId, storeId) {
    return this.checkPermission(userId, "can_delete", `retailstore:${storeId}`);
  }

  // ==================== BOOKING PERMISSION CHECKS ====================

  async canViewAccommodationBooking(userId, bookingId) {
    return this.checkPermission(
      userId,
      "can_view",
      `accommodationbooking:${bookingId}`,
    );
  }

  async canEditAccommodationBooking(userId, bookingId) {
    return this.checkPermission(
      userId,
      "can_edit",
      `accommodationbooking:${bookingId}`,
    );
  }

  async canCancelAccommodationBooking(userId, bookingId) {
    return this.checkPermission(
      userId,
      "can_cancel",
      `accommodationbooking:${bookingId}`,
    );
  }

  async canViewTransportationBooking(userId, bookingId) {
    return this.checkPermission(
      userId,
      "can_view",
      `transportationbooking:${bookingId}`,
    );
  }

  async canEditTransportationBooking(userId, bookingId) {
    return this.checkPermission(
      userId,
      "can_edit",
      `transportationbooking:${bookingId}`,
    );
  }

  async canCancelTransportationBooking(userId, bookingId) {
    return this.checkPermission(
      userId,
      "can_cancel",
      `transportationbooking:${bookingId}`,
    );
  }

  async canViewTravelPackageBooking(userId, bookingId) {
    return this.checkPermission(
      userId,
      "can_view",
      `travelpackagebooking:${bookingId}`,
    );
  }

  async canEditTravelPackageBooking(userId, bookingId) {
    return this.checkPermission(
      userId,
      "can_edit",
      `travelpackagebooking:${bookingId}`,
    );
  }

  async canCancelTravelPackageBooking(userId, bookingId) {
    return this.checkPermission(
      userId,
      "can_cancel",
      `travelpackagebooking:${bookingId}`,
    );
  }

  async canViewExperienceBooking(userId, bookingId) {
    return this.checkPermission(
      userId,
      "can_view",
      `experiencebooking:${bookingId}`,
    );
  }

  async canEditExperienceBooking(userId, bookingId) {
    return this.checkPermission(
      userId,
      "can_edit",
      `experiencebooking:${bookingId}`,
    );
  }

  async canCancelExperienceBooking(userId, bookingId) {
    return this.checkPermission(
      userId,
      "can_cancel",
      `experiencebooking:${bookingId}`,
    );
  }

  // ==================== SHOPPING PERMISSION CHECKS ====================

  async canViewShoppingVisit(userId, visitId) {
    return this.checkPermission(userId, "can_view", `shoppingvisit:${visitId}`);
  }

  async canEditShoppingVisit(userId, visitId) {
    return this.checkPermission(userId, "can_edit", `shoppingvisit:${visitId}`);
  }

  async canCancelShoppingVisit(userId, visitId) {
    return this.checkPermission(
      userId,
      "can_cancel",
      `shoppingvisit:${visitId}`,
    );
  }

  // ==================== EXPERIENCE PERMISSION CHECKS ====================

  async canViewTravelExperience(userId, experienceId) {
    return this.checkPermission(
      userId,
      "can_view",
      `travelexperience:${experienceId}`,
    );
  }

  async canEditTravelExperience(userId, experienceId) {
    return this.checkPermission(
      userId,
      "can_edit",
      `travelexperience:${experienceId}`,
    );
  }

  async canCancelTravelExperience(userId, experienceId) {
    return this.checkPermission(
      userId,
      "can_cancel",
      `travelexperience:${experienceId}`,
    );
  }

  // ==================== FINANCIAL PERMISSION CHECKS ====================

  async canViewTransaction(userId, transactionId) {
    return this.checkPermission(
      userId,
      "can_view",
      `transaction:${transactionId}`,
    );
  }

  async canRefundTransaction(userId, transactionId) {
    return this.checkPermission(
      userId,
      "can_refund",
      `transaction:${transactionId}`,
    );
  }

  async canViewPayout(userId, payoutId) {
    return this.checkPermission(userId, "can_view", `payout:${payoutId}`);
  }

  async canProcessPayout(userId, payoutId) {
    return this.checkPermission(userId, "can_process", `payout:${payoutId}`);
  }

  async canCancelPayout(userId, payoutId) {
    return this.checkPermission(userId, "can_cancel", `payout:${payoutId}`);
  }

  // ==================== TEAM MEMBER PERMISSION CHECKS ====================

  async canManageTeam(userId, memberId) {
    return this.checkPermission(
      userId,
      "can_manage_team",
      `vendor_team_member:${memberId}`,
    );
  }

  async canManageListings(userId, memberId) {
    return this.checkPermission(
      userId,
      "can_manage_listings",
      `vendor_team_member:${memberId}`,
    );
  }

  async canEditListings(userId, memberId) {
    return this.checkPermission(
      userId,
      "can_edit_listings",
      `vendor_team_member:${memberId}`,
    );
  }

  async canViewListings(userId, memberId) {
    return this.checkPermission(
      userId,
      "can_view_listings",
      `vendor_team_member:${memberId}`,
    );
  }

  // ==================== REVIEW PERMISSION CHECKS ====================

  async canViewReview(userId, reviewId) {
    return this.checkPermission(
      userId,
      "can_view",
      `vendor_review:${reviewId}`,
    );
  }

  async canRespondToReview(userId, reviewId) {
    return this.checkPermission(
      userId,
      "can_respond",
      `vendor_review:${reviewId}`,
    );
  }

  async canDeleteReview(userId, reviewId) {
    return this.checkPermission(
      userId,
      "can_delete",
      `vendor_review:${reviewId}`,
    );
  }

  async canHideReview(userId, reviewId) {
    return this.checkPermission(
      userId,
      "can_hide",
      `vendor_review:${reviewId}`,
    );
  }
  // Add to your OpenFGA service class

  // ==================== TRAVEL EXPERIENCE PERMISSION CHECKS ====================

  async canViewTravelExperience(userId, experienceId) {
    return this.checkPermission(
      userId,
      "can_view",
      `travelexperience:${experienceId}`,
    );
  }

  async canEditTravelExperience(userId, experienceId) {
    return this.checkPermission(
      userId,
      "can_edit",
      `travelexperience:${experienceId}`,
    );
  }

  async canDeleteTravelExperience(userId, experienceId) {
    return this.checkPermission(
      userId,
      "can_delete",
      `travelexperience:${experienceId}`,
    );
  }

  // ==================== EXPERIENCE BOOKING PERMISSION CHECKS ====================

  async canViewExperienceBooking(userId, bookingId) {
    return this.checkPermission(
      userId,
      "can_view",
      `experiencebooking:${bookingId}`,
    );
  }

  async canEditExperienceBooking(userId, bookingId) {
    return this.checkPermission(
      userId,
      "can_edit",
      `experiencebooking:${bookingId}`,
    );
  }

  async canCancelExperienceBooking(userId, bookingId) {
    return this.checkPermission(
      userId,
      "can_cancel",
      `experiencebooking:${bookingId}`,
    );
  }

  // ==================== TRAVEL PACKAGE BOOKING PERMISSION CHECKS ====================

  async canViewTravelPackageBooking(userId, bookingId) {
    return this.checkPermission(
      userId,
      "can_view",
      `travelpackagebooking:${bookingId}`,
    );
  }

  async canEditTravelPackageBooking(userId, bookingId) {
    return this.checkPermission(
      userId,
      "can_edit",
      `travelpackagebooking:${bookingId}`,
    );
  }

  async canCancelTravelPackageBooking(userId, bookingId) {
    return this.checkPermission(
      userId,
      "can_cancel",
      `travelpackagebooking:${bookingId}`,
    );
  }

  // ==================== UTILITY METHODS ====================

  async listAccessibleObjects(userId, relation, type) {
    try {
      const client = await this.ensureInitialized();
      const response = await client.listObjects({
        user: `user:${userId}`,
        relation,
        type,
      });
      return response.objects;
    } catch (error) {
      console.error("OpenFGA listObjects error:", error);
      return [];
    }
  }

  async listAccessibleTravelPlans(userId, relation = "can_view") {
    return this.listAccessibleObjects(userId, relation, "travelplan");
  }

  async listAccessibleAccommodations(userId, relation = "can_view") {
    return this.listAccessibleObjects(userId, relation, "accommodation");
  }

  async listAccessibleTransportationProviders(userId, relation = "can_view") {
    return this.listAccessibleObjects(
      userId,
      relation,
      "transportationprovider",
    );
  }

  async listAccessibleTravelPackages(userId, relation = "can_view") {
    return this.listAccessibleObjects(userId, relation, "travelpackage");
  }

  async listAccessibleVendorExperiences(userId, relation = "can_view") {
    return this.listAccessibleObjects(userId, relation, "vendorexperience");
  }

  async listAccessibleRetailStores(userId, relation = "can_view") {
    return this.listAccessibleObjects(userId, relation, "retailstore");
  }

  async batchCheckPermissions(checks) {
    try {
      const client = await this.ensureInitialized();
      const formattedChecks = checks.map(({ userId, relation, object }) => ({
        user: `user:${userId}`,
        relation,
        object,
      }));
      const results = await client.batchCheck(formattedChecks);
      return results;
    } catch (error) {
      console.error("OpenFGA batchCheck error:", error);
      return checks.map(() => ({ allowed: false }));
    }
  }

  async readTuples(query) {
    const client = await this.ensureInitialized();
    return client.read(query);
  }

  async getStoreInfo() {
    return {
      storeId: this.storeId,
      modelId: this.modelId,
      initialized: this.initialized,
    };
  }

  isInitialized() {
    return this.initialized;
  }
}

module.exports = new OpenFGAService();
