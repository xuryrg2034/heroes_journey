using Configs.Entities.Enemies;
using Configs.Entities.Neutral;
using Entities;
using Entities.Enemies;
using Interfaces;
using UnityEngine;
namespace Core.Factories
{
    public class NeutralFactory
    {
        const string GemPath = "Neutrals/GemConfig";
        
        GemConfig _gemConfig;
        
        public NeutralFactory()
        {
            LoadSmallEnemiesConfig();
        }

        public Gem GetGem()
        {
            var entity = Object.Instantiate(_gemConfig.Prefab);

            entity.Init(_gemConfig);

            return entity;
        }

        void LoadSmallEnemiesConfig()
        {
            _gemConfig = Resources.Load<GemConfig>(GemPath);
        }
    }
}
