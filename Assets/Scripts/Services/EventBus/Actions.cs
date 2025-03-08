namespace Services.EventBus
{
    public enum Actions
    {
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