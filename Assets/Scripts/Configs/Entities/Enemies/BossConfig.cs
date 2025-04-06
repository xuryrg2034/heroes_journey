using Entities;
using Entities.Enemies;
using Interfaces;
using Services;
using UnityEngine;
namespace Configs.Entities.Enemies
{
    [CreateAssetMenu(menuName = "Configs/Entities/Enemies/BossConfig", fileName = "BossConfig")]
    public class BossConfig : ScriptableObject, IEnemyConfig
    {
        [field: SerializeField] public int MaxHealth { get; private set; }
        
        [field: SerializeField] public int AggressionLimit { get; private set; }
        
        [field: SerializeField] public Enemy Prefab { get; private set; }

        [field: SerializeField] public EntitySelectionType SelectionType { get; private set; }
        
        [field: SerializeField] public EnemyRank Rank { get; private set; }
    }
}
