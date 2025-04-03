namespace Services.EventBus
{
    public enum GameEvents
    {
        // Gane events
        GameStateChanged,
        
        // Player events
        PlayerTurnStart,
        PlayerRestoreEnergy,

        // Enemy events
        EnemyDied,
        BossDied,
        
        // Statistics events
        StatisticsUpdateTurnCounter,
        StatisticsUpdateKillCounter,
        
        
        //Quests
        AllQuestCompleted,
    }
}