    // Set to true only for local standalone preview outside the dashboard iframe.
    const allowStandalonePreview = false;

    if (!allowStandalonePreview && window.top === window.self) {
      document.body.innerHTML = `
        <div style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#f7f4ef;color:#1f2a33;font-family:Georgia,'Times New Roman',serif;text-align:center;">
          <div>
            <h1 style="margin:0 0 12px;font-size:1.5rem;font-weight:500;">Dashboard Access Only</h1>
            <p style="margin:0;font-size:1rem;line-height:1.5;">This map must be viewed inside the company dashboard.</p>
          </div>
        </div>
      `;
      throw new Error("This map must be viewed inside an iframe.");
    }

    mapboxgl.accessToken = "pk.eyJ1Ijoibmljb2xlYmFjaG1hbiIsImEiOiJjbXFoaG1xaDIwYzB1MnJwcGNpcXZ0M2tsIn0.wUaEcYBfV_jOLz9JsyPwgg";

    const map = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/streets-v12",
      center: [-15, 20],
      zoom: 1.35,
      projection: "mercator",
      pitch: 0,
      bearing: 0,
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false
    });

    const navigationControl = new mapboxgl.NavigationControl();
    map.addControl(navigationControl, "top-right");

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function hashBrokerName(value) {
      let hash = 0;
      const text = String(value || "Unknown Broker");

      for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) - hash + text.charCodeAt(index)) >>> 0;
      }

      return hash;
    }

    function brokerColor(value) {
      const goldenAngle = 137.508;
      const hue = Math.round((hashBrokerName(value) * goldenAngle) % 360);
      return `hsl(${hue}, 65%, 50%)`;
    }

    const squareFootagePalette = ["#f28a7f", "#e45f57", "#c93b3e", "#8f1f28"];
    const acreagePalette = ["#7dc9a3", "#2fa06c", "#0d7a4f", "#085738"];
    const noSquareFootageColor = "#8c949b";

    function hueDistance(a, b) {
      const diff = Math.abs(a - b) % 360;
      return Math.min(diff, 360 - diff);
    }

    function buildBrokerColorMap(features) {
      const brokerNames = Array.from(
        new Set(
          features
            .map((feature) => feature.properties?.broker_name || feature.properties?.Owner || "")
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b));

      const lightnessSteps = [50, 42, 58, 34, 66];
      const assigned = [];
      const colorMap = new Map();

      for (const brokerName of brokerNames) {
        const baseHue = Math.round((hashBrokerName(brokerName) * 137.508) % 360);
        let chosenLightness = lightnessSteps[0];

        for (const candidateLightness of lightnessSteps) {
          const conflicts = assigned.some((existing) => {
            const tooCloseInHue = hueDistance(baseHue, existing.hue) < 18;
            const tooCloseInLightness = Math.abs(candidateLightness - existing.lightness) < 10;
            return tooCloseInHue && tooCloseInLightness;
          });

          if (!conflicts) {
            chosenLightness = candidateLightness;
            break;
          }
        }

        assigned.push({
          brokerName,
          hue: baseHue,
          lightness: chosenLightness
        });

        colorMap.set(brokerName, `hsl(${baseHue}, 65%, ${chosenLightness}%)`);
      }

      return colorMap;
    }

    function getSquareFootageRangeSpecs(minValue) {
      const safeMin = Number.isFinite(minValue) ? minValue : 0;

      return [
        {
          color: squareFootagePalette[0],
          min: safeMin,
          max: 100000,
          label: "0 - 100k"
        },
        {
          color: squareFootagePalette[1],
          min: 100000,
          max: 500000,
          label: "100k - 500k"
        },
        {
          color: squareFootagePalette[2],
          min: 500000,
          max: 1000000,
          label: "500k - 1M"
        },
        {
          color: squareFootagePalette[3],
          min: 1000000,
          max: Number.POSITIVE_INFINITY,
          label: "1M+"
        }
      ];
    }

    function getSquareFootageColor(value, rangeSpecs) {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue) || !Array.isArray(rangeSpecs) || rangeSpecs.length === 0) {
        return noSquareFootageColor;
      }

      for (let index = 0; index < rangeSpecs.length; index += 1) {
        const spec = rangeSpecs[index];
        if (numericValue >= spec.min && numericValue < spec.max) {
          return spec.color;
        }
      }

      return rangeSpecs[rangeSpecs.length - 1].color;
    }

    function getAcreageRangeSpecs() {
      return [
        {
          color: acreagePalette[0],
          min: 0,
          max: 25,
          label: "0 - 25"
        },
        {
          color: acreagePalette[1],
          min: 25,
          max: 50,
          label: "25 - 50"
        },
        {
          color: acreagePalette[2],
          min: 50,
          max: 100,
          label: "50 - 100"
        },
        {
          color: acreagePalette[3],
          min: 100,
          max: Number.POSITIVE_INFINITY,
          label: "100+"
        }
      ];
    }

    function getAcreageColor(value, rangeSpecs) {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue) || !Array.isArray(rangeSpecs) || rangeSpecs.length === 0) {
        return acreagePalette[1];
      }

      for (let index = 0; index < rangeSpecs.length; index += 1) {
        const spec = rangeSpecs[index];
        const isLast = index === rangeSpecs.length - 1;
        if (numericValue >= spec.min && (isLast ? numericValue <= spec.max : numericValue < spec.max)) {
          return spec.color;
        }
      }

      return rangeSpecs[rangeSpecs.length - 1].color;
    }

    function renderLegendItems(elementId, rangeSpecs) {
      const legendItems = document.getElementById(elementId);
      legendItems.innerHTML = rangeSpecs.map((spec) => `
        <div class="legend-item">
          <span class="legend-swatch" style="background:${escapeHtml(spec.color)}"></span>
          <span>${escapeHtml(spec.label)}</span>
        </div>
      `).join("");
    }

    function syncLegendCollapsedState(isCollapsed) {
      const legendPanel = document.querySelector(".legend-panel");
      const legendToggle = document.getElementById("legendToggle");
      if (!legendPanel || !legendToggle) {
        return;
      }

      legendPanel.classList.toggle("is-collapsed", isCollapsed);
      legendToggle.textContent = isCollapsed ? "+" : "-";
      legendToggle.setAttribute("aria-expanded", String(!isCollapsed));
      legendToggle.setAttribute(
        "aria-label",
        isCollapsed ? "Expand legend" : "Minimize legend"
      );
    }

    function bindLegendToggle() {
      const legendPanel = document.querySelector(".legend-panel");
      const legendToggle = document.getElementById("legendToggle");
      if (!legendPanel || !legendToggle) {
        return;
      }

      if (window.innerWidth <= 640 && !legendPanel.classList.contains("is-collapsed")) {
        syncLegendCollapsedState(true);
      }

      legendToggle.addEventListener("click", () => {
        const isCollapsed = !legendPanel.classList.contains("is-collapsed");
        syncLegendCollapsedState(isCollapsed);
      });
    }

    function collapseLegendForMobilePopup() {
      if (window.innerWidth > 640) {
        return;
      }

      const legendPanel = document.querySelector(".legend-panel");
      if (!legendPanel || legendPanel.classList.contains("is-collapsed")) {
        return;
      }

      syncLegendCollapsedState(true);
    }

    function bindFilterToggle() {
      const filterBar = document.getElementById("filterBar");
      const filterToggle = document.getElementById("filterToggle");
      const applyFiltersButton = document.getElementById("applyFilters");
      const card = document.querySelector(".card");
      if (!filterBar || !filterToggle) {
        return;
      }

      function syncFilterPanelState(isOpen) {
        filterBar.classList.toggle("is-open", isOpen);
        card?.classList.toggle("mobile-filters-open", isOpen && window.innerWidth <= 640);
        filterToggle.setAttribute("aria-expanded", String(isOpen));
        filterToggle.setAttribute("aria-label", isOpen ? "Close filters" : "Open filters");
      }

      filterToggle.addEventListener("click", () => {
        const nextOpen = !filterBar.classList.contains("is-open");
        syncFilterPanelState(nextOpen);
      });

      applyFiltersButton?.addEventListener("click", () => {
        applyFilters();
        syncFilterPanelState(false);
      });

      document.addEventListener("click", (event) => {
        if (!filterBar.classList.contains("is-open")) {
          return;
        }

        const target = event.target;
        if (!(target instanceof Node)) {
          return;
        }

        if (filterBar.contains(target) || filterToggle.contains(target)) {
          return;
        }

        syncFilterPanelState(false);
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && filterBar.classList.contains("is-open")) {
          syncFilterPanelState(false);
        }
      });

      window.addEventListener("resize", () => {
        syncFilterPanelState(filterBar.classList.contains("is-open"));
      });
    }

    function updateFilterToggleState() {
      const filterToggle = document.getElementById("filterToggle");
      if (!filterToggle || !filterBounds) {
        return;
      }

      const typeValue = String(document.getElementById("filterType").value || "").trim().toLowerCase();
      const propertyTypeValue = String(
        document.getElementById("filterPropertyType").value || ""
      ).trim().toLowerCase();
      const minSf = parseNumericValue(document.getElementById("filterSfMin").value);
      const maxSf = parseNumericValue(document.getElementById("filterSfMax").value);
      const minAcreage = parseNumericValue(document.getElementById("filterAcreageMin").value);
      const maxAcreage = parseNumericValue(document.getElementById("filterAcreageMax").value);

      const hasActiveFilters = Boolean(
        typeValue ||
        propertyTypeValue ||
        minSf > filterBounds.sfMin ||
        maxSf < filterBounds.sfMax - 0.0001 ||
        minAcreage > filterBounds.acreageMin ||
        maxAcreage < filterBounds.acreageMax - 0.0001
      );

      filterToggle.classList.toggle("has-active-filters", hasActiveFilters);
    }

    function pickFirstNonEmpty(properties, keys) {
      for (const key of keys) {
        const value = properties?.[key];
        if (value === 0 || value === "0") {
          return value;
        }

        if (value !== undefined && value !== null && String(value).trim() !== "") {
          return value;
        }
      }

      return "";
    }

    function formatCurrency(value) {
      const text = String(value ?? "").trim();
      if (!text) {
        return "";
      }

      const digitsOnly = text.replace(/,/g, "");
      if (!/^\d+(\.\d+)?$/.test(digitsOnly)) {
        return text;
      }

      const amount = Number(digitsOnly);
      if (!Number.isFinite(amount)) {
        return text;
      }

      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0
      }).format(amount);
    }

    function compactDealName(value) {
      const text = String(value ?? "").trim();
      if (!text) {
        return "";
      }

      const parts = text.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 3) {
        return parts[parts.length - 1];
      }

      return text;
    }

    function popupMarkup(properties) {
      const brokerName = pickFirstNonEmpty(properties, ["broker_name", "Owner"]) || "Unknown Broker";
      const markerColor = properties.marker_color || brokerColor(brokerName);
      const address = pickFirstNonEmpty(properties, [
        "address",
        "street_address",
        "Deal: Deal Name"
      ]) || "Listing Details";
      const recordType = pickFirstNonEmpty(properties, ["record_type", "Deal: Record Type"]);
      const askingPrice = formatCurrency(
        pickFirstNonEmpty(properties, ["asking_price", "Asking Price"])
      );
      const leaseRate = pickFirstNonEmpty(properties, ["lease_rate", "Lease Rate"]);
      const squareFootage = pickFirstNonEmpty(properties, ["square_footage", "Square Footage"]);
      const acreage = pickFirstNonEmpty(properties, ["acreage", "Acreage"]);
      const leaseSquareFootage = pickFirstNonEmpty(properties, [
        "lease_square_footage",
        "Lease Square Footage"
      ]);
      const effectiveDate = pickFirstNonEmpty(properties, [
        "listing_effective_date",
        "Listing Effective Date"
      ]);
      const expirationDate = pickFirstNonEmpty(properties, [
        "listing_expiration_date",
        "Listing Expiration Date"
      ]);
      const isLandListing = !String(squareFootage).trim() && String(acreage).trim();
      const popupMetaValue = isLandListing
        ? `${acreage} AC`
        : `${squareFootage || "N/A"} SF`;
      const isLease = String(recordType).trim().toLowerCase() === "lease";
      const fields = [
        ["Broker", brokerName],
        ["Record Type", recordType],
        ["Asking Price", askingPrice],
        ["Acreage", acreage],
        ["Effective Date", effectiveDate],
        ["Expiration Date", expirationDate]
      ];

      if (isLease) {
        fields.splice(2, 1);
        fields.splice(3, 0, ["Lease Rate", leaseRate]);
        fields.splice(6, 0, ["Lease Sq Ft", leaseSquareFootage]);
      }

      return `
        <div class="popup">
          <h3>${escapeHtml(address)}</h3>
          <div class="popup-broker">
            <span class="broker-dot" style="background:${escapeHtml(markerColor)}" aria-hidden="true"></span>
            <span class="popup-meta">${escapeHtml(popupMetaValue)}</span>
          </div>
          <dl>
            ${fields.map(([label, value, isHtml]) => `
              <dt>${escapeHtml(label)}</dt>
              <dd>${isHtml ? value : escapeHtml(value || "N/A")}</dd>
            `).join("")}
          </dl>
        </div>
      `;
    }

    function showError(message) {
      const errorEl = document.getElementById("error");
      errorEl.textContent = message;
      errorEl.style.display = "block";
    }

    function parseNumericValue(value) {
      const digitsOnly = String(value ?? "").replace(/[^0-9.]/g, "");
      if (!digitsOnly) {
        return null;
      }

      const number = Number(digitsOnly);
      return Number.isFinite(number) ? number : null;
    }

    function formatCompactNumber(value, prefix = "") {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        return `${prefix}0`;
      }

      if (Math.abs(number) >= 1000000) {
        return `${prefix}${(number / 1000000).toFixed(number % 1000000 === 0 ? 0 : 1)}M`;
      }

      if (Math.abs(number) >= 1000) {
        return `${prefix}${(number / 1000).toFixed(number % 1000 === 0 ? 0 : 1)}k`;
      }

      return `${prefix}${Math.round(number)}`;
    }

    function formatAcreageValue(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        return "0";
      }

      if (number === 0) {
        return "0.0";
      }

      if (Number.isInteger(number)) {
        return String(number);
      }

      return number.toFixed(number < 10 ? 1 : 0);
    }

    function unifyWaterColor() {
      const waterColor = "#d0d2cf";
      const styleLayers = map.getStyle()?.layers || [];

      for (const layer of styleLayers) {
        if (!/\bwater\b/i.test(layer.id)) {
          continue;
        }

        if (layer.type === "fill") {
          map.setPaintProperty(layer.id, "fill-color", waterColor);
        }

        if (layer.type === "line") {
          map.setPaintProperty(layer.id, "line-color", waterColor);
        }
      }
    }

    function deepenWaterLabelColor() {
      const labelColor = "#7f827f";
      const styleLayers = map.getStyle()?.layers || [];

      for (const layer of styleLayers) {
        if (layer.type !== "symbol") {
          continue;
        }

        if (!/\bwater\b/i.test(layer.id) && !/\bmarine\b/i.test(layer.id)) {
          continue;
        }

        if (layer.paint?.["text-color"] !== undefined) {
          map.setPaintProperty(layer.id, "text-color", labelColor);
        }
      }
    }

    function warmLandPaletteSlightly() {
      const layerColors = {
        land: { property: "background-color", value: "#f1f1ee" },
        landcover: { property: "fill-color", value: "#e1e4de" },
        "national-park": { property: "fill-color", value: "#dbe1d8" },
        landuse: { property: "fill-color", value: "#e8e8e4" },
        "land-structure-polygon": { property: "fill-color", value: "#e6e6e2" },
        "land-structure-line": { property: "line-color", value: "#dfe0da" }
      };

      for (const [layerId, config] of Object.entries(layerColors)) {
        if (!map.getLayer(layerId)) {
          continue;
        }

        map.setPaintProperty(layerId, config.property, config.value);
      }
    }

    function softenLocalRoadColors() {
      const localRoadColor = "#e8e7e2";
      const styleLayers = map.getStyle()?.layers || [];
      const localRoadPatterns = [
        /\broad-street\b/i,
        /\broad-residential\b/i,
        /\broad-service\b/i,
        /\broad-minor\b/i,
        /\bbridge-street\b/i,
        /\bbridge-residential\b/i,
        /\bbridge-service\b/i,
        /\btunnel-street\b/i,
        /\btunnel-residential\b/i,
        /\btunnel-service\b/i
      ];

      for (const layer of styleLayers) {
        if (layer.type !== "line") {
          continue;
        }

        const layerId = String(layer.id || "");
        if (!localRoadPatterns.some((pattern) => pattern.test(layerId))) {
          continue;
        }

        if (layer.paint?.["line-color"] !== undefined) {
          map.setPaintProperty(layerId, "line-color", localRoadColor);
        }
      }
    }

    function softenMinorHighwayOpacity() {
      const minorHighwayOpacity = 0.68;
      const styleLayers = map.getStyle()?.layers || [];
      const minorHighwayPatterns = [
        /\broad-primary\b/i,
        /\bbridge-primary\b/i,
        /\btunnel-primary\b/i
      ];

      for (const layer of styleLayers) {
        if (layer.type !== "line") {
          continue;
        }

        const layerId = String(layer.id || "");
        if (!minorHighwayPatterns.some((pattern) => pattern.test(layerId))) {
          continue;
        }

        if (layer.paint?.["line-opacity"] !== undefined) {
          map.setPaintProperty(layerId, "line-opacity", minorHighwayOpacity);
        }
      }
    }

    function removeMountainShading() {
      const styleLayers = map.getStyle()?.layers || [];
      const shadingPatterns = [
        /\bhillshade\b/i,
        /\bterrain\b/i
      ];

      for (const layer of styleLayers) {
        const layerId = String(layer.id || "");
        if (!shadingPatterns.some((pattern) => pattern.test(layerId))) {
          continue;
        }

        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, "visibility", "none");
        }
      }
    }

    function delayHighwayVisibility() {
      const minHighwayZoom = 5.75;
      const highwayLayerIds = [
        "road-motorway-trunk-case",
        "road-motorway-trunk"
      ];
      const styleLayers = map.getStyle()?.layers || [];

      for (const layerId of highwayLayerIds) {
        const layer = styleLayers.find((candidate) => candidate.id === layerId);
        if (!layer) {
          continue;
        }

        map.setLayerZoomRange(
          layerId,
          Math.max(layer.minzoom ?? 0, minHighwayZoom),
          layer.maxzoom
        );
      }
    }

    function delayStreetVisibility() {
      const minStreetZoom = 11.5;
      const styleLayers = map.getStyle()?.layers || [];
      const streetLayerPatterns = [
        /\broad-(secondary|tertiary)\b/i,
        /\broad-street\b/i,
        /\broad-residential\b/i,
        /\broad-service\b/i,
        /\broad-minor\b/i,
        /\bbridge-(secondary|tertiary)\b/i,
        /\bbridge-street\b/i,
        /\bbridge-residential\b/i,
        /\bbridge-service\b/i,
        /\btunnel-(secondary|tertiary)\b/i,
        /\btunnel-street\b/i,
        /\btunnel-residential\b/i,
        /\btunnel-service\b/i
      ];
      const preservedStreetLayerPatterns = [
        /\bmotorway\b/i,
        /\btrunk\b/i
      ];

      for (const layer of styleLayers) {
        if (layer.type !== "line") {
          continue;
        }

        const layerId = String(layer.id || "");
        if (preservedStreetLayerPatterns.some((pattern) => pattern.test(layerId))) {
          continue;
        }

        if (!streetLayerPatterns.some((pattern) => pattern.test(layerId))) {
          continue;
        }

        map.setLayerZoomRange(
          layerId,
          Math.max(layer.minzoom ?? 0, minStreetZoom),
          layer.maxzoom
        );
      }
    }

    function delayMinorHighwayVisibility() {
      const minMinorHighwayZoom = 9.5;
      const styleLayers = map.getStyle()?.layers || [];
      const minorHighwayPatterns = [
        /\broad-primary\b/i,
        /\bbridge-primary\b/i,
        /\btunnel-primary\b/i
      ];

      for (const layer of styleLayers) {
        if (layer.type !== "line") {
          continue;
        }

        const layerId = String(layer.id || "");
        if (!minorHighwayPatterns.some((pattern) => pattern.test(layerId))) {
          continue;
        }

        map.setLayerZoomRange(
          layerId,
          Math.max(layer.minzoom ?? 0, minMinorHighwayZoom),
          layer.maxzoom
        );
      }
    }

    function delayStateLabelVisibility() {
      const minStateLabelZoom = 4.2;
      const layerId = "state-label";
      const styleLayer = map.getStyle()?.layers?.find((layer) => layer.id === layerId);
      if (!styleLayer) {
        return;
      }

      map.setLayerZoomRange(
        layerId,
        Math.max(styleLayer.minzoom ?? 0, minStateLabelZoom),
        styleLayer.maxzoom
      );
    }

    function delayNonMajorCityLabelVisibility() {
      const minPlaceZoom = 9;
      const styleLayers = map.getStyle()?.layers || [];
      const delayedPlaceLayerPatterns = [
        /\bsettlement-minor-label\b/i,
        /\bsettlement-subdivision-label\b/i,
        /\bsettlement-neighborhood-label\b/i,
        /\bplace-town-label\b/i,
        /\bplace-village-label\b/i,
        /\bplace-suburb-label\b/i
      ];
      const preservedPlaceLayerPatterns = [
        /\bsettlement-major-label\b/i,
        /\bplace-city-label\b/i,
        /\bplace-capital-label\b/i
      ];

      for (const layer of styleLayers) {
        if (layer.type !== "symbol") {
          continue;
        }

        const layerId = layer.id;
        if (preservedPlaceLayerPatterns.some((pattern) => pattern.test(layerId))) {
          continue;
        }

        if (!delayedPlaceLayerPatterns.some((pattern) => pattern.test(layerId))) {
          continue;
        }

        const layerMinZoom = layer.minzoom ?? 0;
        const layerMaxZoom = layer.maxzoom;
        map.setLayerZoomRange(
          layerId,
          Math.max(layerMinZoom, minPlaceZoom),
          layerMaxZoom
        );
      }
    }

    let allPointFeatures = [];
    let popup = null;
    let filterBounds = null;
    let squareFootageRangeSpecs = [];
    let acreageRangeSpecs = [];

    function syncMobilePopupState() {
      const card = document.querySelector(".card");
      if (!card) {
        return;
      }

      if (Boolean(popup) && window.innerWidth <= 640) {
        collapseLegendForMobilePopup();
      }

      card.classList.toggle("mobile-popup-open", Boolean(popup) && window.innerWidth <= 640);
    }

    function fitToFeatures(features) {
      if (!Array.isArray(features) || features.length === 0) {
        return;
      }

      if (window.innerWidth <= 640) {
        map.easeTo({
          center: [-98, 39],
          zoom: 2.15,
          duration: 0
        });
        return;
      }

      const bounds = new mapboxgl.LngLatBounds();
      features.forEach((feature) => {
        bounds.extend(feature.geometry.coordinates);
      });

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
          padding: { top: 60, right: 60, bottom: 60, left: 60 },
          maxZoom: 12,
          duration: 0
        });
      }
    }

    function applyFilters() {
      const source = map.getSource("listings");
      if (!source) {
        return;
      }

      const typeValue = String(document.getElementById("filterType").value || "").trim().toLowerCase();
      const propertyTypeValue = String(
        document.getElementById("filterPropertyType").value || ""
      ).trim().toLowerCase();
      const minSf = parseNumericValue(document.getElementById("filterSfMin").value);
      const maxSf = parseNumericValue(document.getElementById("filterSfMax").value);
      const minAcreage = parseNumericValue(document.getElementById("filterAcreageMin").value);
      const maxAcreage = parseNumericValue(document.getElementById("filterAcreageMax").value);
      const sfFilterIsNarrowed = Boolean(
        filterBounds && (minSf > filterBounds.sfMin || maxSf < filterBounds.sfMax - 0.0001)
      );
      const acreageFilterIsNarrowed = Boolean(
        filterBounds && (minAcreage > filterBounds.acreageMin || maxAcreage < filterBounds.acreageMax - 0.0001)
      );

      const filteredFeatures = allPointFeatures.filter((feature) => {
        const properties = feature.properties || {};
        const recordType = String(
          pickFirstNonEmpty(properties, ["record_type", "Deal: Record Type"])
        ).trim().toLowerCase();
        const squareFootage = parseNumericValue(
          pickFirstNonEmpty(properties, ["square_footage", "Square Footage"])
        );
        const acreage = parseNumericValue(
          pickFirstNonEmpty(properties, ["acreage", "Acreage"])
        );
        const propertyType = squareFootage === null && acreage !== null ? "land" : "building";

        if (typeValue && recordType !== typeValue) {
          return false;
        }

        if (propertyTypeValue && propertyType !== propertyTypeValue) {
          return false;
        }

        if (sfFilterIsNarrowed && squareFootage === null) {
          return false;
        }

        if (minSf !== null && squareFootage !== null && squareFootage < minSf) {
          return false;
        }

        if (maxSf !== null && squareFootage !== null && squareFootage > maxSf) {
          return false;
        }

        if (acreageFilterIsNarrowed && acreage === null) {
          return false;
        }

        if (minAcreage !== null && acreage !== null && acreage < minAcreage) {
          return false;
        }

        if (maxAcreage !== null && acreage !== null && acreage > maxAcreage) {
          return false;
        }

        return true;
      });

      if (popup) {
        popup.remove();
        popup = null;
      }

      syncMobilePopupState();

      source.setData({
        type: "FeatureCollection",
        features: filteredFeatures
      });

      updateFilterToggleState();
    }

    function syncRangePair(kind) {
      const minInput = document.getElementById(`filter${kind}Min`);
      const maxInput = document.getElementById(`filter${kind}Max`);
      const fill = document.getElementById(`filter${kind}Fill`);
      const minValue = Math.min(Number(minInput.value), Number(maxInput.value));
      const maxValue = Math.max(Number(minInput.value), Number(maxInput.value));
      const minBound = Number(minInput.min);
      const maxBound = Number(minInput.max);

      minInput.value = String(minValue);
      maxInput.value = String(maxValue);

      const minLabel = document.getElementById(`filter${kind}MinValue`);
      const maxLabel = document.getElementById(`filter${kind}MaxValue`);
      const minDisplay = kind === "Acreage" ? formatAcreageValue(minValue) : formatCompactNumber(minValue);
      const maxDisplay = kind === "Acreage" ? formatAcreageValue(maxValue) : formatCompactNumber(maxValue);

      minLabel.textContent = minDisplay;
      maxLabel.textContent = maxDisplay;

      if (fill && Number.isFinite(minBound) && Number.isFinite(maxBound) && maxBound > minBound) {
        const startPercent = ((minValue - minBound) / (maxBound - minBound)) * 100;
        const endPercent = ((maxValue - minBound) / (maxBound - minBound)) * 100;
        fill.style.left = `${startPercent}%`;
        fill.style.width = `${Math.max(endPercent - startPercent, 0)}%`;
      }
    }

    function initializeRangeFilters(features) {
      const sfValues = features
        .map((feature) => parseNumericValue(
          pickFirstNonEmpty(feature.properties, ["square_footage", "Square Footage"])
        ))
        .filter((value) => value !== null);
      const acreageValues = features
        .map((feature) => parseNumericValue(
          pickFirstNonEmpty(feature.properties, ["acreage", "Acreage"])
        ))
        .filter((value) => value !== null);

      const sfMin = sfValues.length ? Math.min(...sfValues) : 0;
      const sfMax = sfValues.length ? Math.max(...sfValues) : 1000000;
      const acreageMin = 0;
      const acreageMax = acreageValues.length ? Math.max(...acreageValues) : 100;

      filterBounds = { sfMin, sfMax, acreageMin, acreageMax };

      const sfMinInput = document.getElementById("filterSfMin");
      const sfMaxInput = document.getElementById("filterSfMax");
      sfMinInput.min = String(sfMin);
      sfMinInput.max = String(sfMax);
      sfMinInput.step = "any";
      sfMinInput.value = String(sfMin);
      sfMaxInput.min = String(sfMin);
      sfMaxInput.max = String(sfMax);
      sfMaxInput.step = "any";
      sfMaxInput.value = String(sfMax);

      const acreageMinInput = document.getElementById("filterAcreageMin");
      const acreageMaxInput = document.getElementById("filterAcreageMax");
      acreageMinInput.min = String(acreageMin);
      acreageMinInput.max = String(acreageMax);
      acreageMinInput.step = "any";
      acreageMinInput.value = String(acreageMin);
      acreageMaxInput.min = String(acreageMin);
      acreageMaxInput.max = String(acreageMax);
      acreageMaxInput.step = "any";
      acreageMaxInput.value = String(acreageMax);

      syncRangePair("Sf");
      syncRangePair("Acreage");
      updateFilterToggleState();
    }

    function bindFilters() {
      document.getElementById("filterType").addEventListener("change", applyFilters);
      document.getElementById("filterPropertyType").addEventListener("change", applyFilters);
      document.getElementById("filterSfMin").addEventListener("input", () => {
        syncRangePair("Sf");
        applyFilters();
      });
      document.getElementById("filterSfMax").addEventListener("input", () => {
        syncRangePair("Sf");
        applyFilters();
      });
      document.getElementById("filterAcreageMin").addEventListener("input", () => {
        syncRangePair("Acreage");
        applyFilters();
      });
      document.getElementById("filterAcreageMax").addEventListener("input", () => {
        syncRangePair("Acreage");
        applyFilters();
      });
      function clearAllFilters() {
        document.getElementById("filterType").value = "";
        document.getElementById("filterPropertyType").value = "";
        if (filterBounds) {
          document.getElementById("filterSfMin").value = String(filterBounds.sfMin);
          document.getElementById("filterSfMax").value = String(filterBounds.sfMax);
          document.getElementById("filterAcreageMin").value = String(filterBounds.acreageMin);
          document.getElementById("filterAcreageMax").value = String(filterBounds.acreageMax);
          syncRangePair("Sf");
          syncRangePair("Acreage");
        }
        applyFilters();
      }

      document.getElementById("clearFiltersDesktop").addEventListener("click", clearAllFilters);
      document.getElementById("clearFiltersMobile").addEventListener("click", clearAllFilters);
    }

    async function loadListings() {
      try {
        unifyWaterColor();
        deepenWaterLabelColor();
        warmLandPaletteSlightly();
        softenLocalRoadColors();
        softenMinorHighwayOpacity();
        removeMountainShading();
        delayHighwayVisibility();
        delayStreetVisibility();
        delayMinorHighwayVisibility();
        delayStateLabelVisibility();
        delayNonMajorCityLabelVisibility();
        bindLegendToggle();
        bindFilterToggle();

        const response = await fetch("./locations.geojson", {
          mode: "same-origin",
          credentials: "same-origin",
          referrerPolicy: "strict-origin-when-cross-origin"
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const geojson = await response.json();
        if (!Array.isArray(geojson.features)) {
          throw new Error("Invalid GeoJSON structure.");
        }

        const pointFeatures = geojson.features.filter(
          (feature) => feature.geometry?.type === "Point"
        );

        const sfValues = pointFeatures
          .map((feature) => parseNumericValue(
            pickFirstNonEmpty(feature.properties, ["square_footage", "Square Footage"])
          ))
          .filter((value) => value !== null);
        const acreageValues = pointFeatures
          .map((feature) => parseNumericValue(
            pickFirstNonEmpty(feature.properties, ["acreage", "Acreage"])
          ))
          .filter((value) => value !== null);
        const sfMin = sfValues.length ? Math.min(...sfValues) : 0;
        squareFootageRangeSpecs = getSquareFootageRangeSpecs(sfMin);
        const acreageMin = acreageValues.length ? Math.min(...acreageValues) : 0;
        const acreageMax = acreageValues.length ? Math.max(...acreageValues) : 1;
        acreageRangeSpecs = getAcreageRangeSpecs(acreageMin, acreageMax);
        renderLegendItems("legendSfItems", squareFootageRangeSpecs);
        renderLegendItems("legendAcreageItems", acreageRangeSpecs);

        pointFeatures.forEach((feature) => {
          const squareFootage = parseNumericValue(
            pickFirstNonEmpty(feature.properties, ["square_footage", "Square Footage"])
          );
          const acreage = parseNumericValue(
            pickFirstNonEmpty(feature.properties, ["acreage", "Acreage"])
          );

          feature.properties = {
            ...feature.properties,
            marker_color: squareFootage === null
              ? (acreage === null
                ? noSquareFootageColor
                : getAcreageColor(acreage, acreageRangeSpecs))
              : getSquareFootageColor(squareFootage, squareFootageRangeSpecs)
          };
        });
        allPointFeatures = pointFeatures;
        initializeRangeFilters(pointFeatures);

        map.addSource("listings", {
          type: "geojson",
          data: {
            ...geojson,
            features: pointFeatures
          }
        });

        map.addLayer({
          id: "listing-pin-shadow",
          type: "circle",
          source: "listings",
          paint: {
            "circle-radius": 10,
            "circle-color": "rgba(31, 42, 51, 0.08)",
            "circle-blur": 0.55,
            "circle-translate": [0, 4]
          }
        });

        map.addLayer({
          id: "listing-pin",
          type: "circle",
          source: "listings",
          paint: {
            "circle-radius": 7,
            "circle-color": ["coalesce", ["get", "marker_color"], "#d34b32"],
            "circle-stroke-width": 0.75,
            "circle-stroke-color": "#fff8f2"
          }
        });

        function getSafePadding() {
          const isMobile = window.innerWidth <= 900;
          const horizontal = isMobile ? 14 : 24;
          const top = isMobile ? 6 : 24;
          const bottom = isMobile ? 8 : 28;
          return { top, right: horizontal, bottom, left: horizontal };
        }

        function keepPopupInView() {
          if (!popup) {
            return;
          }

          const popupEl = popup.getElement();
          if (!popupEl) {
            return;
          }

          const mapRect = map.getContainer().getBoundingClientRect();
          const popupRect = popupEl.getBoundingClientRect();
          const padding = getSafePadding();

          let dx = 0;
          let dy = 0;

          if (popupRect.left < mapRect.left + padding.left) {
            dx = mapRect.left + padding.left - popupRect.left;
          } else if (popupRect.right > mapRect.right - padding.right) {
            dx = mapRect.right - padding.right - popupRect.right;
          }

          if (popupRect.top < mapRect.top + padding.top) {
            dy = mapRect.top + padding.top - popupRect.top;
          } else if (popupRect.bottom > mapRect.bottom - padding.bottom) {
            dy = mapRect.bottom - padding.bottom - popupRect.bottom;
          }

          if (dx !== 0 || dy !== 0) {
            map.panBy([-dx, -dy], {
              duration: 450,
              essential: true
            });
          }

          return { dx, dy, popupRect, mapRect, padding };
        }

        function createPopupForPoint(point) {
          const isMobile = window.innerWidth <= 900;
          const mapHeight = map.getContainer().clientHeight;
          const anchor = isMobile
            ? (point.y < mapHeight * 0.42 ? "top" : "bottom")
            : undefined;
          const offset = isMobile ? 10 : 18;

          if (popup) {
            popup.remove();
          }

          const popupOptions = {
            closeButton: true,
            closeOnClick: false,
            offset,
            maxWidth: "min(320px, calc(100vw - 32px))"
          };

          if (anchor) {
            popupOptions.anchor = anchor;
          }

          popup = new mapboxgl.Popup(popupOptions);
          popup.on("close", () => {
            popup = null;
            syncMobilePopupState();
          });

          return popup;
        }

        function maybeFlipPopupAnchor(result, feature, point) {
          if (!popup || !result) {
            return;
          }

          const isMobile = window.innerWidth <= 900;
          if (!isMobile) {
            return;
          }

          const overTop = result.popupRect.top < result.mapRect.top + result.padding.top;
          const overBottom = result.popupRect.bottom > result.mapRect.bottom - result.padding.bottom;

          if (!overTop && !overBottom) {
            return;
          }

          const nextAnchor = popup.options.anchor === "top" ? "bottom" : "top";

          const nextPopup = new mapboxgl.Popup({
            anchor: nextAnchor,
            closeButton: true,
            closeOnClick: false,
            offset: 10,
            maxWidth: "min(320px, calc(100vw - 32px))"
          });

          popup.remove();
          popup = nextPopup
            .setLngLat(feature.geometry.coordinates)
            .setHTML(popupMarkup(feature.properties || {}))
            .addTo(map);

          window.requestAnimationFrame(() => {
            keepPopupInView();
          });
        }

        map.on("click", "listing-pin", (event) => {
          const feature = event.features?.[0];
          if (!feature) {
            return;
          }

          const popupLngLat = popup?.getLngLat();
          const [featureLng, featureLat] = feature.geometry.coordinates || [];
          const isSamePopupOpen = Boolean(
            popup &&
            popupLngLat &&
            Math.abs(popupLngLat.lng - featureLng) < 0.000001 &&
            Math.abs(popupLngLat.lat - featureLat) < 0.000001
          );

          if (isSamePopupOpen) {
            popup.remove();
            popup = null;
            syncMobilePopupState();
            return;
          }

          createPopupForPoint(event.point)
            .setLngLat(feature.geometry.coordinates)
            .setHTML(popupMarkup(feature.properties || {}))
            .addTo(map);

          syncMobilePopupState();

          window.requestAnimationFrame(() => {
            const result = keepPopupInView();
            maybeFlipPopupAnchor(result, feature, event.point);
          });
        });

        map.on("click", (event) => {
          const clickedPins = map.queryRenderedFeatures(event.point, {
            layers: ["listing-pin"]
          });

          if (clickedPins.length === 0 && popup) {
            popup.remove();
            popup = null;
            syncMobilePopupState();
          }
        });

        map.on("mouseenter", "listing-pin", () => {
          map.getContainer().classList.add("pin-hover");
        });

        map.on("mouseleave", "listing-pin", () => {
          map.getContainer().classList.remove("pin-hover");
        });

        bindFilters();
        fitToFeatures(pointFeatures);
      } catch (error) {
        console.error("Failed to load listings:", error);
        showError(
          "Could not load locations.geojson. If you opened this file directly in the browser, serve the folder locally with a simple web server first."
        );
      }
    }

    map.on("load", loadListings);