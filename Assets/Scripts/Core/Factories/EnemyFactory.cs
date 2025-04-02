using Configs.Entities.Enemies;
using Entities.Enemies;
using UnityEngine;
namespace Core.Factories
{
    public class EnemyFactory
    {
        const string EnemiesPath = "Enemies";

        SmallEnemyConfig[] _smallEnemiesList;
        
        public EnemyFactory()
        {
            LoadSmallEnemiesConfig();
        }
        
        public Enemy GetRandomSmallEnemy()
        {
            var config = _smallEnemiesList[Random.Range(0, _smallEnemiesList.Length)];
            var enemy = Object.Instantiate(config.Prefab);

            enemy.Init(config);

            return enemy;
        }

        void LoadSmallEnemiesConfig()
        {
            _smallEnemiesList = Resources.LoadAll<SmallEnemyConfig>(EnemiesPath);
        }
    }
}
