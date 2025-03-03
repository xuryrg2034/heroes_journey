namespace Services.EventBus
{
    public enum Actions
    {
        // Player events
        PlayerTurnStart,
        PlayerRestoreEnergy,
        PlayerChainingAttackCombo,

        // Enemy events
        EnemyDied,
        
        // Statistics events
        StatisticsUpdateTurnCounter,
        StatisticsUpdateKillCounter,
    }
}