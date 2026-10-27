/** A valid Monsieur Cuisine recipe input, written by hand the way an assistant would. */
export const validSoup = {
  "title": "Silky Tomato Soup",
  "description": "A quick, velvety tomato soup with sweet onion and a savoury stock base.",
  "settings": {
    "locale": "en-US",
    "complexityId": 22
  },
  "servingSize": {
    "amount": 2,
    "unit": "servings",
    "instruction": "Chop the onion, sauté it in oil for 3 minutes, add tomatoes and stock, simmer for 15 minutes, purée until smooth and season with salt.",
    "preparationTime": 5,
    "readyInTime": 25,
    "ingredientGroups": [
      {
        "name": "",
        "ingredients": [
          {
            "name": "onion, halved",
            "amount": 1,
            "unit": "pieces",
            "isOptional": false
          },
          {
            "name": "olive oil",
            "amount": 15,
            "unit": "g",
            "isOptional": false
          },
          {
            "name": "canned chopped tomatoes",
            "amount": 400,
            "unit": "g",
            "isOptional": false
          },
          {
            "name": "vegetable stock",
            "amount": 300,
            "unit": "g",
            "isOptional": false
          },
          {
            "name": "salt",
            "amount": "1",
            "unit": "pinch",
            "isOptional": false
          }
        ]
      }
    ],
    "steps": [
      {
        "title": "Add onion",
        "description": "Put 1 halved onion into the mixing bowl.",
        "mode": {
          "type": "none"
        }
      },
      {
        "title": "Chop onion",
        "description": "",
        "mode": {
          "type": "manualCooking",
          "temperature": 0,
          "minutes": 0,
          "seconds": 5,
          "speed": 5,
          "rotationDirection": "right"
        }
      },
      {
        "title": "Weigh oil",
        "description": "Scrape down the bowl and add 15 g olive oil.",
        "mode": {
          "type": "scale",
          "grams": 15
        }
      },
      {
        "title": "Sauté onion",
        "description": "",
        "mode": {
          "type": "roast",
          "temperature": 120,
          "minutes": 3,
          "seconds": 0
        }
      },
      {
        "title": "Weigh tomatoes",
        "description": "Add 400 g canned chopped tomatoes.",
        "mode": {
          "type": "scale",
          "grams": 400
        }
      },
      {
        "title": "Weigh stock",
        "description": "Add 300 g vegetable stock.",
        "mode": {
          "type": "scale",
          "grams": 300
        }
      },
      {
        "title": "Simmer soup",
        "description": "",
        "mode": {
          "type": "manualCooking",
          "temperature": 100,
          "minutes": 15,
          "seconds": 0,
          "speed": 1,
          "rotationDirection": "left"
        }
      },
      {
        "title": "Purée soup",
        "description": "",
        "mode": {
          "type": "puree",
          "minutes": 1,
          "seconds": 0
        }
      },
      {
        "title": "Season and serve",
        "description": "Season with a pinch of salt and serve hot.",
        "mode": {
          "type": "none"
        }
      }
    ]
  },
  "categoryIds": [],
  "nutrients": [
    {
      "name": "calories",
      "unit": "kCal",
      "amount": 150
    },
    {
      "name": "carbohydrate",
      "unit": "g",
      "amount": 16
    },
    {
      "name": "fat",
      "unit": "g",
      "amount": 8
    },
    {
      "name": "protein",
      "unit": "g",
      "amount": 4
    }
  ]
};

interface MutableRecipe {
  servingSize: { steps: Array<{ mode: Record<string, unknown> }> };
}

/** The soup with step 6 (the simmer step: manualCooking, 100 °C) changed — e.g. to break a device limit. */
export function soupWithStep6Mode(mode: Record<string, unknown>): unknown {
  const copy: MutableRecipe = structuredClone(validSoup);
  const step = copy.servingSize.steps[6];
  if (!step) throw new TypeError("fixture is missing step 6");
  step.mode = { ...step.mode, ...mode };
  return copy;
}
