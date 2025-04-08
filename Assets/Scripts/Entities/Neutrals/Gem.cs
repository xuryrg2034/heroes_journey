using Interfaces;

namespace Entities.Enemies
{
    public class Gem : BaseEntity
    {
        public void Init(INeutralConfig config)
        {
            base.Init(config);
            
            SelectionType = config.SelectionType;
        }
    }
}