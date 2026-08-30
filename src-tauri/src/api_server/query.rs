use serde::Deserialize;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LimitQuery {
    pub limit: Option<u32>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DateQuery {
    pub date: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DateLimitQuery {
    pub date: Option<String>,
    pub limit: Option<u32>,
    pub include_icons: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionPageQuery {
    pub date: Option<String>,
    pub offset: Option<u32>,
    pub limit: Option<u32>,
    pub filter_text: Option<String>,
    pub app_id: Option<String>,
    pub sort_field: Option<String>,
    pub sort_dir: Option<String>,
    pub include_icons: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TimelineQuery {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

pub fn include_icons_default_false(value: Option<bool>) -> bool {
    value.unwrap_or(false)
}
