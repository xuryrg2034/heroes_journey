using Entities;
using Entities.Enemies;
using Interfaces;
using UnityEngine;
namespace Configs.Entities.Neutral
{
    [CreateAssetMenu(menuName = "Configs/Entities/Neutral/Gem", fileName = "Gem")]
    public class GemConfig : ScriptableObject, INeutralConfig
    {
        [field: SerializeField] public int MaxHealth { get; private set; }
        
        [field: SerializeField] public Gem Prefab { get; private set; }

        [field: SerializeField] public EntitySelectionType SelectionType { get; private set; }
    }
}
